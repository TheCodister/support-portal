#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { SupportDeskStack } from "../lib/supportdesk-stack.js";
import { DemoExpiryStack } from "../lib/demo-expiry-stack.js";
import { GitHubDeployStack } from "../lib/github-deploy-stack.js";
const app = new App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? "us-east-1" };
new SupportDeskStack(app, "SupportDesk", { env, stageName: app.node.tryGetContext("stage") ?? "learning" });
const demoExpiresAt = app.node.tryGetContext("demoExpiresAt") as string | undefined;
const amplifyAppId = app.node.tryGetContext("amplifyAppId") as string | undefined;
if (demoExpiresAt || amplifyAppId) {
  if (!demoExpiresAt || Number.isNaN(new Date(demoExpiresAt).getTime())) throw new Error("demoExpiresAt is required for demo expiry");
  new DemoExpiryStack(app, "SupportDeskDemoExpiry", { env, amplifyAppId, expiresAt: new Date(demoExpiresAt) });
}
new GitHubDeployStack(app, "SupportDeskGitHubDeploy", { env, repository: app.node.tryGetContext("githubRepository") ?? "TheCodister/support-portal", branch: app.node.tryGetContext("deployBranch") ?? "main", amplifyAppId });
