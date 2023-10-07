import {
	SecretsManagerClient,
	GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import mysql from 'mysql';
import beginTransaction from './beginTransaction.js';
import query from './query.js';
import commit from './commit.js';
import rollback from './rollback.js';

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
	const shopify_domain = body.shopify_domain;
	const products = body.products;
	var where_list = [];
	products.forEach(product => {
		let value_str = `variant_id = '${product.variant_id}'`;
		where_list.push(value_str);
	});
	var where_str = where_list.join(' OR ');// NG

	const secret_name = "shopify_app";
	const client = new SecretsManagerClient({
		region: "ap-northeast-1",
	});

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
	const selectSql = `
	SELECT
		id,
		variant_id,
		product_id,
		inventory_policy,
		inventory_management
	FROM
		product_variant
	WHERE
		(${where_str})
	AND
		shopify_domain = '${shopify_domain}'
	AND
		deleted = false;
	`;
	// Get exist varints
	var selectResult = [];
	try {
		await beginTransaction(connection);
		selectResult = await query(connection, selectSql);
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

	// check exist variants
	var update_variants = [];
	var create_variants = [];
	products.forEach(product => {
		let update_input = null;
		let update_target_variant = [];
		if (selectResult && selectResult.length > 0) {
			update_target_variant = selectResult.filter(old_variant => old_variant.variant_id === product.variant_id && old_variant.product_id === product.product_id);
		}
		if (
			update_target_variant
			&& update_target_variant.length > 0
			&& (
				update_target_variant[0].inventory_policy !== 'continue'
				|| update_target_variant[0].inventory_management !== 'shopify'
			)
		) {
			// Add updated product in the array
			update_input = {};
			update_input.id = update_target_variant[0].id;
			update_input.inventory_policy = 'continue';
			update_input.inventory_management = 'shopify';
			update_variants.push(update_input);
		}
		if (!update_target_variant || (update_target_variant && update_target_variant.length === 0)) {
			// Add create product in the array
			let input = {};
			input.shopify_domain = shopify_domain;
			input.product_id = product.product_id;
			input.variant_id = product.variant_id;
			input.inventory_policy = 'continue';
			input.inventory_management = 'shopify';
			create_variants.push(input);
		}
	});

	if (update_variants.length > 0) {
		// Update existing variants
		const update_id_list = update_variants.map(variant => variant.id);
		const update_inventory_policy_list = update_variants.map(variant => variant.inventory_policy);
		const update_inventory_management_list = update_variants.map(variant => variant.inventory_management);
		const update_id_string = convertArrayToStrForBulkUpdate(update_id_list);
		const update_inventory_policy_string = convertArrayToStrForBulkUpdate(update_inventory_policy_list);
		const update_inventory_management_string = convertArrayToStrForBulkUpdate(update_inventory_management_list);
		const updateSql = `
		UPDATE product_variant SET
		inventory_policy = ELT(FIELD(id,${update_id_string}),${update_inventory_policy_string}),
		inventory_management = ELT(FIELD(id,${update_id_string}),${update_inventory_management_string})
		WHERE id IN (${update_id_string});
		`;
		try {
			await beginTransaction(connection);
			await query(connection, updateSql);
			await commit(connection);
		} catch (err) {
			await rollback(connection);
			console.error('Failed update', err);
			response.statusCode = 500;
			response.body = {
				errors: [{
					code: '03',
					message: 'Internal error.',
				}]
			};
			return response;
		}
	}

	if (create_variants.length > 0) {
		// Insert new variants
		var value_list = [];
		create_variants.forEach(variant => {
			let tmp_list = [shopify_domain, variant.product_id, variant.variant_id, variant.inventory_policy, variant.inventory_management];
			let value_str = convertArrayToStrForBulkUpdate(tmp_list);
			value_str = '(' + value_str + ')';
			value_list.push(value_str);
		});
		var values_string = value_list.join();
		const insertSql = `
		INSERT INTO product_variant (
			shopify_domain,
			product_id,
			variant_id,
			inventory_policy,
			inventory_management
		) VALUES
			${values_string};
		`;
		try {
			await beginTransaction(connection);
			await query(connection, insertSql);
			await commit(connection);
		} catch (err) {
			await rollback(connection);
			console.error('Failed insert', err);
			response.statusCode = 500;
			response.body = {
				errors: [{
					code: '05',
					message: 'Internal error.',
				}]
			};
			return response;
		}
	}
	
	return response;
};

function convertArrayToStrForBulkUpdate(array) {
	let string = JSON.stringify(array);
	string = string.replace(/[\[\]]/g, '').replace(/"/g, "'");
	return string;
}

// https://z9g7yrsp7d.execute-api.ap-northeast-1.amazonaws.com/savePreorderProductBulkDev
