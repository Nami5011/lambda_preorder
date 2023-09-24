import axios from "axios";
export const handler = async (event) => {
	const response = {
		statusCode: 200,
		body: JSON.stringify('OK'),
	};
	// console.log('event', event);
	const shop_domain = event?.shopify_domain;
	const line_items = event?.line_items;
	const cart_id = 'gid://shopify/Cart/' + event?.id; // hopefully?????????

	const getStorefrontUrl = 'https://coi5iaiiw0.execute-api.ap-northeast-1.amazonaws.com/getStorefrontDev';
	const getStorefrontReqestBody = {};
	getStorefrontReqestBody.app_name = 'pre-order';
	getStorefrontReqestBody.shopify_domain = 'https://' + shop_domain;

	var storefrontAccessRes = [];
	var storefrontAccessToken = null;
	try {
		storefrontAccessRes = await axios.post(getStorefrontUrl, getStorefrontReqestBody);
		// console.log('STOREFRONT -', storefrontAccessRes?.data?.body);
		storefrontAccessRes = storefrontAccessRes?.data?.body;
		if (storefrontAccessRes && storefrontAccessRes.length > 0 && storefrontAccessRes[0]?.storefront_key) {
			storefrontAccessToken = storefrontAccessRes[0]?.storefront_key;
		}
	} catch(e) {
		console.error('Failed getStorefrontAccess');
		console.error(e);
	}
	if (!storefrontAccessToken) {
		response = {
			statusCode: 500,
			body: JSON.stringify('no storefrontAccessToken'),
		};
		return response;
	}

	if (!line_items || (line_items && line_items.length === 0)) {
		return response;
	}
	console.log('line_items', line_items);
	var item_id_list = [];
	var line_quantity = {};
	line_items.forEach(item => {
		item_id_list.push('gid://shopify/ProductVariant/' + item.variant_id);
		line_quantity['gid://shopify/ProductVariant/' + item.variant_id] = Number(item.quantity);
	});
	// var ids = JSON.stringify(item_id_list);
	console.log('item_id_list.length', item_id_list.length);
	console.log('Object.keys(line_quantity).length', Object.keys(line_quantity).length);

	const variantQuery = `{
		cart(id: "${cart_id}") {
			lines(first: ${Object.keys(line_quantity).length}) {
				nodes {
					id
					attributes {
						key
						value
					}
					merchandise {
						... on ProductVariant {
							id
							availableForSale
							quantityAvailable
							currentlyNotInStock
							product {
								id
								title
							}
						}
					}
				}
			}
		}
	}`;
	// check deliveryGroups later
	console.log(variantQuery);

	// Get Cart lines
	var res;
	try {
		res = await axios.post('https://' + shop_domain +'/api/2023-07/graphql.json', variantQuery, {
			headers: {
				'Content-Type': 'application/graphql',
				'X-Shopify-Storefront-Access-Token': storefrontAccessToken
			}
		});
		if (!res?.data) throw res;
		// product id -> gid://shopify/Product/ + number
	} catch(e) {
		console.error('Failed storefront api');
		console.error(e);
		response = {
			statusCode: 500,
			body: JSON.stringify('Failed storefront api'),
		};
		return response;
	}
	const responseData = res?.data;
	// Cart lines
	const cart_lines = responseData?.data?.cart?.lines?.nodes;
	console.log('cart_lines', cart_lines);

	// Create Cart Line update body
	var cart_line_update_body = createCartLineUpdateBody(cart_id, cart_lines, line_quantity);

	if (cart_line_update_body === null) {
		// No update data
		return response;
	}
	console.log('cart_line_update_body', JSON.stringify(cart_line_update_body ?? '', null , "\t"));

	try {
		res = await axios.post('https://' + shop_domain +'/api/2023-07/graphql.json', JSON.stringify(cart_line_update_body), {
			headers: {
				'Content-Type': 'application/json',
				'X-Shopify-Storefront-Access-Token': storefrontAccessToken
			}
		});
		if (!res?.data) throw res;
		// product id -> gid://shopify/Product/ + number
	} catch(e) {
		console.error('Failed storefront api');
		console.error(e);
		response = {
			statusCode: 500,
			body: JSON.stringify('Failed storefront api'),
		};
		return response;
	}

	return response;
};

function createCartLineUpdateBody(cart_id, cart_lines, line_quantity) {
	let cart_line_update_variables = {};
	let cart_update_lines = [];
	cart_lines.forEach(line => {
		if (line.merchandise.availableForSale
			&& Number(line.merchandise.quantityAvailable) <= 0 && line.merchandise.currentlyNotInStock // inventory_policy === 'CONTINUE' && line_quantity[line.merchandise.id] >= Number(line.merchandise.quantityAvailable)
		) {
			let input_line = {};
			let attribute_update_flg = false;
			let attribute_key = 'Preorder';
			// check line.attributes here 09/22
			input_line['attributes'] = line.attributes;
			if (line.attributes && line.attributes.length > 0) {
				line.attributes.forEach((att, index) => {
					if (att.key === attribute_key) {
						line.attributes[index].value = String(line_quantity[line.merchandise.id]);
						attribute_update_flg = true;
					}
				})
			}
			if (!attribute_update_flg) {
				input_line['attributes'].push(
					{
						key: attribute_key,
						value: String(line_quantity[line.merchandise.id])
					}
				);
			}
			input_line['id'] = line.id;
			cart_update_lines.push(input_line);
		}
	});

	// No update data
	if (cart_update_lines.length === 0) {
		return null;
	}

	cart_line_update_variables['cartId'] = cart_id;
	cart_line_update_variables['lines'] = cart_update_lines;
	let cart_line_update_query = `
	mutation cartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
		cartLinesUpdate(cartId: $cartId, lines: $lines) {
			userErrors {
				field
				message
			}
		}
	}`;
	let cart_line_update_body = {
		query: cart_line_update_query,
		variables: cart_line_update_variables
	};
	return cart_line_update_body;
}

