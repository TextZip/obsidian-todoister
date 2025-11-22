import { getAuthToken, revokeToken } from "@doist/todoist-api-typescript";
import { obsidianFetchAdapter } from "./obsidian-fetch-adapter.ts";

const TODOIST_CLIENT_ID = "6bdd562b50494f838bc3ceafe1531f3d";
const TODOIST_CLIENT_SECRET = "fba07cbd788c4a038e7e3581debce8f0";
const OAUTH_REDIRECT_URI = "obsidian://todoister-oauth";

export function generateAuthUrl(state: string): string {
	const params = new URLSearchParams({
		client_id: TODOIST_CLIENT_ID,
		scope: "data:read_write",
		state,
		redirect_uri: OAUTH_REDIRECT_URI,
	});
	return `https://todoist.com/oauth/authorize?${params.toString()}`;
}

export async function getAccessToken(
	code: string,
): Promise<{ accessToken: string }> {
	return await getAuthToken(
		{
			clientId: TODOIST_CLIENT_ID,
			clientSecret: TODOIST_CLIENT_SECRET,
			code,
		},
		{
			customFetch: obsidianFetchAdapter,
		},
	);
}

export async function revokeAccessToken(token: string): Promise<void> {
	await revokeToken(
		{
			clientId: TODOIST_CLIENT_ID,
			clientSecret: TODOIST_CLIENT_SECRET,
			token,
		},
		{
			customFetch: obsidianFetchAdapter,
		},
	);
}
