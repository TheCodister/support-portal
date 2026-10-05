import { CfnOutput, Duration, Stack, type StackProps, Tags } from "aws-cdk-lib";
import { Effect, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { CfnSchedule } from "aws-cdk-lib/aws-scheduler";
import { Construct } from "constructs";

export interface DemoExpiryProps extends StackProps {
  amplifyAppId?: string;
  expiresAt: Date;
}

export class DemoExpiryStack extends Stack {
  constructor(scope: Construct, id: string, props: DemoExpiryProps) {
    super(scope, id, props);
    Tags.of(this).add("Project", "SupportDesk");
    Tags.of(this).add("Environment", "learning");

    const role = new Role(this, "ExpiryRole", { assumedBy: new ServicePrincipal("scheduler.amazonaws.com") });
    if (props.amplifyAppId) role.addToPolicy(new PolicyStatement({ effect: Effect.ALLOW, actions: ["amplify:DeleteApp"], resources: [`arn:aws:amplify:${this.region}:${this.account}:apps/${props.amplifyAppId}`] }));
    role.addToPolicy(new PolicyStatement({ effect: Effect.ALLOW, actions: ["cloudformation:DeleteStack"], resources: [`arn:aws:cloudformation:${this.region}:${this.account}:stack/SupportDesk/*`] }));

    const schedule = (name: string, when: Date, arn: string, input: object) => new CfnSchedule(this, name, {
      scheduleExpression: `at(${when.toISOString().slice(0, 19)})`,
      scheduleExpressionTimezone: "UTC",
      flexibleTimeWindow: { mode: "OFF" },
      target: { arn, roleArn: role.roleArn, input: JSON.stringify(input) }
    });
    if (props.amplifyAppId) schedule("DeleteAmplifyApp", props.expiresAt, "arn:aws:scheduler:::aws-sdk:amplify:deleteApp", { AppId: props.amplifyAppId });
    schedule("DeleteBackendStack", new Date(props.expiresAt.getTime() + (props.amplifyAppId ? Duration.minutes(5).toMilliseconds() : 0)), "arn:aws:scheduler:::aws-sdk:cloudformation:deleteStack", { StackName: "SupportDesk" });
    new CfnOutput(this, "ExpiresAtUtc", { value: props.expiresAt.toISOString() });
  }
}
