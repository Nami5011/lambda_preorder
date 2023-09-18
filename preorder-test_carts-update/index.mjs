import AWS from "aws-sdk";
var lambda = new AWS.Lambda();
export const handler = async (event) => {
	var invoke_body = {};
	invoke_body.shopify_domain = event?.detail?.metadata['X-Shopify-Shop-Domain'];
	invoke_body.line_items = event?.detail?.payload?.line_items;
	invoke_body.id = event?.detail?.payload?.id;

	let invoke_prm = {
		function_name: "private-preorder-carts-update",
		body: invoke_body,
	};
	await lambda_invoke(invoke_prm);
	
	var response = {
		statusCode: 200,
		body: [],
	};
	return response;
};
function lambda_invoke(obj){
	return new Promise((resolve, reject) => {
		let params = {
			FunctionName: obj.function_name,
			//InvocationType: "RequestResponse", // 同期
			InvocationType: "Event", // 非同期
			Payload: JSON.stringify(obj.body),
		};
		lambda.invoke(params, function(err, data){
			if(err) {
				reject(err, err);
			} else {
				resolve(data);
			}
		});
	});
}
