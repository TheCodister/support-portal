#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { SupportDeskStack } from "../lib/supportdesk-stack.js";
const app = new App();
new SupportDeskStack(app, "SupportDesk", { env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? "us-east-1" }, stageName: app.node.tryGetContext("stage") ?? "learning" });
