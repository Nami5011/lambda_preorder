import axios from "axios";
export const handler = async (event) => {
	// TODO implement
	// console.log('event', event);
	const shop_domain = event?.shopify_domain;
	const line_items = event?.line_items;
	const cart_id = event?.id; // hopefully?????????

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
		const response = {
			statusCode: 500,
			body: JSON.stringify('no storefrontAccessToken'),
		};
		return response;
	}
	const QUERY = `{
		products (first: 3) {
			nodes {
				id
				title
			}
		}
	}`;
	var products = [];
	try {
		const res = await axios.post('https://' + shop_domain +'/api/2023-07/graphql.json', QUERY, {
			headers: {
				'Content-Type': 'application/graphql',
				'X-Shopify-Storefront-Access-Token': storefrontAccessToken
			}
		});
		products = res?.data;
		products = products?.data?.products;
		console.log('products', products);
		// const result = await res.json();
		// products = result?.data?.products?.edges;
		// console.log('products: ', products);
	} catch(e) {
		console.error('Failed storefront api');
		console.error(e);
	}

	const response = {
		statusCode: 200,
		body: JSON.stringify('Hello from Lambda!'),
	};
	return response;
};
