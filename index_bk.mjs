import axios from "axios";
export const handler = async (event) => {
	// console.log('event: ', event);
	const shop_domain = event?.detail?.metadata['X-Shopify-Shop-Domain'];
	const line_items = event?.detail?.payload?.line_items;
	// const storefrontAccessToken = '30180fe6d6c7ad2f28a5ea732c57d8da';

	console.log('shop domain: ', shop_domain);
	console.log('cartline_items: ', line_items);

	const getStorefrontUrl = 'https://coi5iaiiw0.execute-api.ap-northeast-1.amazonaws.com/getStorefrontDev';
	const getStorefrontReqestBody = {};
	getStorefrontReqestBody.app_name = 'pre-order';
	getStorefrontReqestBody.shopify_domain = 'https://' + shop_domain;
	// const QUERY = `{
	// 	products (first: 3) {
	// 		edges {
	// 			node {
	// 				id
	// 				title
	// 			}
	// 		}
	// 	}
	// }`;
	// console.log('query: ', QUERY);
	let products = [];
	var storefrontAccessTokenList = [];
	try {
		storefrontAccessTokenList = await axios.post(getStorefrontUrl, getStorefrontReqestBody);
		console.log(storefrontAccessTokenList?.data);
		// const res = await fetch('https://' + "sample-store-200.myshopify.com" +'/api/2023-07/graphql.json', {
		// 	method: 'POST',
		// 	headers: {
		// 		'Content-Type': 'application/graphql',
		// 		'X-Shopify-Storefront-Access-Token': storefrontAccessToken
		// 	},
		// 	body: QUERY,
		// });
		// const result = await res.json();
		// products = result?.data?.products?.edges;
		// console.log('products: ', products);
	} catch(e) {
		console.error(e);
	}
    const response = {
        statusCode: 200,
        body: products,
    };
    return response;
};
