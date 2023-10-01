import axios from "axios";
export const handler = async (event) => {
	const response = {
		statusCode: 200,
		body: JSON.stringify('OK'),
	};
	// console.log('event', event);
	const shop_domain = event?.shopify_domain;
	const line_items = event?.line_items;
	const cart_id = 'gid://shopify/Cart/' + event?.id;

	const getStorefrontUrl = 'https://coi5iaiiw0.execute-api.ap-northeast-1.amazonaws.com/getStorefrontDev';
	const getStorefrontReqestBody = {};
	getStorefrontReqestBody.app_name = 'pre-order';
	getStorefrontReqestBody.shopify_domain = 'https://' + shop_domain;

	var storefrontAccessRes = [];
	var storefrontAccessToken = null;
	try {
		storefrontAccessRes = await axios.post(getStorefrontUrl, getStorefrontReqestBody);
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
	console.log('cart_lines from graphql', cart_lines);
	if (!cart_lines || (cart_lines && cart_lines.length === 0)) {
		// No cart data
		return response;
	}

	// Get inventory_policy
	const getProductVariantUrl = 'https://gye30h0z9f.execute-api.ap-northeast-1.amazonaws.com/getProductVariant';
	let products = cart_lines.map(line => {
		return {
			variant_id: line?.merchandise?.id,
			product_id: line?.merchandise?.product?.id
		};
	});
	let getProductReqestBody = {
		shopify_domain: shop_domain,
		products: products,
		inventory_policy: 'continue'
	};
	console.log('GET PRODUCT VARIANT: ', getProductReqestBody);
	var preorderProductList = [];
	try {
		let getProductReqestRes = await axios.post(getProductVariantUrl, getProductReqestBody);
		preorderProductList = getProductReqestRes?.data?.body;
	} catch(e) {
		console.error('Failed getStorefrontAccess');
		console.error(e);
	}

	// Create Cart Line update body
	var cart_line_update_body = createCartLineUpdateBody(cart_id, cart_lines, line_quantity, preorderProductList);
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
		console.log(res?.data);
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

function createCartLineUpdateBody(cart_id, cart_lines, line_quantity, preorderProductList) {
	let cart_line_update_variables = {};
	let cart_update_lines = [];
	cart_lines.forEach(line => {
		// check if it's Keep selling when out of stock
		let preorderProduct = preorderProductList.filter(product => product.product_id === line?.merchandise?.product?.id && product.variant_id === line?.merchandise?.id && product.inventory_policy === 'continue');
		let isPreorderProduct = preorderProduct && preorderProduct.length > 0 && line.merchandise.availableForSale;
		
		// Count pre-order quantity
		let preorderQuantity = 0;
		if (isPreorderProduct && line_quantity[line.merchandise.id] > Number(line.merchandise.quantityAvailable)) {
			if (Number(line.merchandise.quantityAvailable) <= 0) {
				preorderQuantity = line_quantity[line.merchandise.id];
			} else {
				preorderQuantity = line_quantity[line.merchandise.id] - Number(line.merchandise.quantityAvailable);
			}
		}

		// Sort out cart attributes
		let input_line = {};
		input_line['attributes'] = [];
		let attribute_key = 'Pre-order';
		if (line.attributes && line.attributes.length > 0) {
			line.attributes.forEach((att) => {
				if (att.key !== attribute_key) {
					// push other attributes
					input_line['attributes'].push(att);
				}
			});
		}
		if (preorderQuantity > 0) {
			// attribute for Pre-order
			input_line['attributes'].push(
				{
					key: attribute_key,
					value: String(preorderQuantity)
				}
			);
		}
		// if (input_line['attributes'].length > 0) {
		input_line['id'] = line.id;
		cart_update_lines.push(input_line);
		// }
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

