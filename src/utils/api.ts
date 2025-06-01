import { server$ } from '@qwik.dev/router';
import { isBrowser } from '@qwik.dev/core/build';
import type { DocumentNode } from 'graphql/index';
import { print } from 'graphql/index';
import { AUTH_TOKEN, DEV_API, HEADER_AUTH_TOKEN_KEY, PROD_API } from '~/constants';
import type { Options as RequesterOptions } from '~/graphql-wrapper';
import { getCookie, setCookie } from '.';

type ResponseProps<T> = { token: string; data: T };
type ExecuteProps<V> = { query: string; variables?: V };
type Options = { method: string; headers: Record<string, string>; body: string };

const baseUrl = import.meta.env.DEV ? DEV_API : PROD_API;
const shopApi = `${baseUrl}/shop-api`;

export const requester = async <R, V>(
	doc: DocumentNode,
	vars?: V,
	options: RequesterOptions = { token: '', apiUrl: shopApi, channelToken: '' }
): Promise<R> => {
	options.apiUrl = options?.apiUrl ?? shopApi;
	return execute<R, V>({ query: print(doc), variables: vars }, options);
};

const execute = async <R, V = Record<string, any>>(
	body: ExecuteProps<V>,
	options: RequesterOptions
): Promise<R> => {
	const requestOptions = {
		method: 'POST',
		headers: createHeaders(),
		body: JSON.stringify(body),
	};
	if (options.token) {
		requestOptions.headers = {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${options.token ?? ''}`,
		};
	}
	if (options.channelToken) {
		requestOptions.headers['vendure-token'] = options.channelToken;
	}

	const response: ResponseProps<R> =
		isBrowser && !import.meta.env.DEV
			? await executeOnTheServer(requestOptions, options.apiUrl!)
			: await executeRequest(requestOptions, options.apiUrl!);

	// DELETE THIS
	// const response: ResponseProps<R> = await executeRequest(requestOptions, options.apiUrl!);

	if (!response.data) {
		console.warn('[execute] Response data is undefined:', response);
		return {} as R;
	}
	if (typeof response.data === 'object' && 'activeOrder' in response.data && !response.data.activeOrder) {
		console.warn('[execute] activeOrder is undefined in response.data:', response.data);
	}

	if (isBrowser && response.token) {
		setCookie(AUTH_TOKEN, response.token, 365);
	}

	return response.data;
};

const createHeaders = () => {
	let headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (isBrowser) {
		const token = getCookie(AUTH_TOKEN);
		headers = { ...headers, Authorization: `Bearer ${token}` };
	}
	return headers;
};

const executeOnTheServer = server$(async (options: Options, apiUrl: string) =>
	executeRequest(options, apiUrl)
);

const executeRequest = async (options: Options, _apiUrl: string) => {
	const localBaseUrl = import.meta.env.VITE_VENDURE_LOCAL_URL;
	const shopApiUrl = `${localBaseUrl.replace(/\/$/, '')}/shop-api`;
	let httpResponse: Response = new Response();
	try {
		httpResponse = await fetch(shopApiUrl, options);
	} catch (error) {
		console.error(`Could not fetch from ${shopApiUrl}. Reason: ${error}`);
	}
	return await extractTokenAndData(httpResponse, shopApiUrl);
};

const extractTokenAndData = async (response: Response, apiUrl: string) => {
	if (response.body === null) {
		console.error(`Emtpy request body for a call to ${apiUrl}`);
		return { token: '', data: {} };
	}
	const token = response.headers.get(HEADER_AUTH_TOKEN_KEY) || '';
	let parsed;
	try {
		parsed = await response.json();
		console.log('[extractTokenAndData] Backend response:', parsed);
	} catch (e) {
		console.error('[extractTokenAndData] Failed to parse JSON:', e);
		return { token, data: {} };
	}
	const { data, errors } = parsed || {};
	if (errors && !data) {
		// e.g. API access related errors, like auth issues.
		throw new Error(errors[0].message);
	}
	if (!data) {
		console.warn('[extractTokenAndData] No data returned from backend:', parsed);
		return { token, data: {} };
	}
	return { token, data };
};
