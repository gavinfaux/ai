import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Octokit } from "octokit";
import { GitHubHandler } from "./github-handler";
import type { Env } from "../worker-configuration";
import type { Props } from "./utils";

export class MyMCP extends McpAgent<Env, Props> {
	server = new McpServer({
		name: "Github OAuth Proxy Demo",
		version: "1.0.0",
	});
	async init() {
		const ALLOWED_USERNAMES: Set<string> = new Set(
			// Add GitHub usernames of users who should have access to the image generation tool
			// For example: 'yourusername', 'coworkerusername'
			(this.env.ALLOWED_USERNAMES || "")
				.split(",")
				.map((username) => username.trim())
				.filter((username) => username !== ""),
		);
		// Hello, world!
		this.server.tool(
			"add",
			"Add two numbers the way only MCP can",
			{ a: z.number(), b: z.number() },
			async ({ a, b }) => ({
				content: [{ type: "text", text: String(a + b) }],
			}),
		);

		// Use the upstream access token to facilitate tools
		this.server.tool(
			"userInfoOctokit",
			"Get user info from GitHub, via Octokit",
			{},
			async () => {
				const octokit = new Octokit({ auth: this.props.accessToken });
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(await octokit.rest.users.getAuthenticated()),
						},
					],
				};
			},
		);

		if (typeof this.props.login === "string" && ALLOWED_USERNAMES.has(this.props.login)) {
			// Dynamically add tools based on the user's login. In this case, I want to limit
			// access to my Image Generation tool to just me

			this.server.tool(
				"generateImage",
				"Generate an image using the `flux-1-schnell` model. Works best with 8 steps.",
				{
					prompt: z
						.string()
						.describe("A text description of the image you want to generate."),
					steps: z
						.number()
						.min(4)
						.max(8)
						.default(4)
						.describe(
							"The number of diffusion steps; higher values can improve quality but take longer. Must be between 4 and 8, inclusive.",
						),
				},
				async ({ prompt, steps }) => {
					const response = await this.env.AI.run("@cf/black-forest-labs/flux-1-schnell", {
						prompt,
						steps,
					});

					return {
						content: [{ type: "image", data: response.image!, mimeType: "image/jpeg" }],
					};
				},
			);
		}
	}
}

export default new OAuthProvider({
	apiRoute: "/sse",
	//@ts-ignore
	apiHandler: MyMCP.mount("/sse"),
	//@ts-ignore
	defaultHandler: GitHubHandler,
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
});
