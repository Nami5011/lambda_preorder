import {
	SecretsManagerClient,
	GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import mysql from 'mysql';
import beginTransaction from './beginTransaction.js';
import query from './query.js';

export const handler = async (event) => {
	if (event.httpMethod === 'OPTIONS') {
		// This is a preflight request, respond with CORS headers
		const response = {
			statusCode: 200,
			headers: {
				'Access-Control-Allow-Origin': '*',
			},
			body: JSON.stringify({ message: 'Preflight request successful' }),
		};
		return response;
	}
	console.log('==============================');
	/**
	 * @type {{
	 *  shopify_domain: string
	 *  products: array
	 *  product_id: string
	 *  variant_id: string
	 * }}
	 */
	const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
	const secret_name = "shopify_app";
	const client = new SecretsManagerClient({
		region: "ap-northeast-1",
	});
	var response = {
		statusCode: 200,
		headers: {
			'Access-Control-Allow-Origin': '*',
		},
		body: [],
	};
	// Validate request data
	if (!body?.shopify_domain || !body?.products) {
		response.statusCode = 500;
		response.body = {
			errors: [{
				code: '01',
				message: 'Invalid request.',
			}]
		};
		return response;
	}

	// Get secret from Secret manager
	var secret = {};
	try {
		secret = await client.send(
			new GetSecretValueCommand({
				SecretId: secret_name,
				VersionStage: "AWSCURRENT", // VersionStage defaults to AWSCURRENT if unspecified
			})
		);
		secret = JSON.parse(secret.SecretString);
	} catch (error) {
		console.log('error!', error);
	}

	// End process if secret is unavailable
	if (!secret?.port || !secret?.username || !secret?.password) {
		response.statusCode = 500;
		response.body = {
			errors: [{
				code: '02',
				message: 'Internal error.',
			}]
		};
		return response;
	}

	const connection = mysql.createConnection({
		host: 'rds-proxy-dev.proxy-cvjdm5qq5ueh.ap-northeast-1.rds.amazonaws.com',
		port: secret.port,
		database: 'shopify_app',
		user: secret.username,
		password: secret.password
	});

	const variant_id_list = body.products.map(product => product.variant_id);
	const product_id_list = body.products.map(product => product.product_id);

	var excuteSql = `
		SELECT
			product_id,
			variant_id,
			inventory_policy,
			inventory_management
		FROM
			product_variant
		WHERE
			shopify_domain = '${body.shopify_domain}'
	`;
	if (body?.inventory_policy === 'continue') {
		excuteSql += `AND
			inventory_policy = 'continue'
		AND
		inventory_management = 'shopify'
		`;
	}
	excuteSql += `AND
		variant_id IN (${convertArrayToStrForBulkUpdate(variant_id_list)})
	AND
		product_id IN (${convertArrayToStrForBulkUpdate(product_id_list)})
	AND
		deleted = false;
	`;
	console.log(excuteSql);
	// Get token
	var selectResult = [];
	try {
		await beginTransaction(connection);
		selectResult = await query(connection, excuteSql);
	} catch (err) {
		console.error(err);
		response.statusCode = 500;
		response.body = {
			errors: [{
				code: '03',
				message: 'Internal error.',
			}]
		};
		return response;
	}

	// End process if token exists
	if (selectResult && selectResult.length > 0) {
		console.log('variant exists ', selectResult);
		response.body = selectResult;
		return response;
	}

	return response;
};

function convertArrayToStrForBulkUpdate(array) {
	let string = JSON.stringify(array);
	string = string.replace(/[\[\]]/g, '').replace(/"/g, "'");
	return string;
}
