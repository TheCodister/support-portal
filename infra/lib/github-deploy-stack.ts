import { CfnOutput, Duration, Stack, type StackProps, Tags } from "aws-cdk-lib";
import { Effect, OpenIdConnectProvider, PolicyStatement, Role, WebIdentityPrincipal } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface GitHubDeployProps extends StackProps {
  /** OIDC `sub` prefix. Repositories using GitHub's immutable subject format send `repo:<owner>@<ownerId>/<repo>@<repoId>`. */
  subjectPrefix: string;
  branch: string;
  amplifyAppId?: string;
}

// Lets GitHub Actions on one branch deploy SupportDesk through short-lived OIDC credentials instead of stored keys.
// Kept separate from SupportDesk so the demo expiry can delete the application stack without touching this role.
export class GitHubDeployStack extends Stack {
  constructor(scope: Construct, id: string, props: GitHubDeployProps) {
    super(scope, id, props);
    Tags.of(this).add("Project", "SupportDesk");

    const provider = new OpenIdConnectProvider(this, "GitHubOidc", { url: "https://token.actions.githubusercontent.com", clientIds: ["sts.amazonaws.com"] });
    const role = new Role(this, "DeployRole", {
      description: `Deploys SupportDesk from ${props.subjectPrefix}:${props.branch}`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com", "token.actions.githubusercontent.com:sub": `${props.subjectPrefix}:ref:refs/heads/${props.branch}` }
      })
    });
    const account = this.account; const region = this.region;
    const allow = (actions: string[], resources: string[], conditions?: Record<string, Record<string, string>>) => role.addToPolicy(new PolicyStatement({ effect: Effect.ALLOW, actions, resources, conditions }));

    // CDK deploys through its bootstrap roles, which hold the CloudFormation permissions.
    allow(["sts:AssumeRole"], [`arn:aws:iam::${account}:role/cdk-hnb659fds-*-${account}-${region}`]);
    allow(["cloudformation:DescribeStacks"], [`arn:aws:cloudformation:${region}:${account}:stack/SupportDesk/*`]);
    allow(["ecr:GetAuthorizationToken"], ["*"]);
    allow(["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:CompleteLayerUpload", "ecr:DescribeImages", "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart"], [`arn:aws:ecr:${region}:${account}:repository/supportdesk-*`]);
    allow(["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"], ["*"]);
    allow(["ecs:RunTask"], [`arn:aws:ecs:${region}:${account}:task-definition/SupportDeskMigrateTask*`]);
    allow(["ecs:DescribeTasks"], [`arn:aws:ecs:${region}:${account}:task/*`]);
    allow(["iam:PassRole"], [`arn:aws:iam::${account}:role/SupportDesk-MigrateTask*`], { StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } });
    if (props.amplifyAppId) {
      allow(["amplify:GetApp"], [`arn:aws:amplify:${region}:${account}:apps/${props.amplifyAppId}`]);
      allow(["amplify:CreateDeployment", "amplify:StartDeployment", "amplify:GetJob"], [`arn:aws:amplify:${region}:${account}:apps/${props.amplifyAppId}/branches/*`]);
    }

    new CfnOutput(this, "DeployRoleArn", { value: role.roleArn });
  }
}
