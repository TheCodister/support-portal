import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, Tags } from "aws-cdk-lib";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { HttpApi, VpcLink } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpAlbIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Alarm, ComparisonOperator, Metric } from "aws-cdk-lib/aws-cloudwatch";
import { Vpc, SubnetType, SecurityGroup, Peer, Port, InstanceClass, InstanceSize, InstanceType } from "aws-cdk-lib/aws-ec2";
import { Cluster, ContainerImage, FargateTaskDefinition, LogDrivers, OperatingSystemFamily, CpuArchitecture, FargateService, AwsLogDriverMode, ContainerInsights, Secret as EcsSecret } from "aws-cdk-lib/aws-ecs";
import { ApplicationLoadBalancer, ApplicationProtocol } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Repository } from "aws-cdk-lib/aws-ecr";
import { DatabaseInstance, DatabaseInstanceEngine, PostgresEngineVersion, Credentials } from "aws-cdk-lib/aws-rds";
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods } from "aws-cdk-lib/aws-s3";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { EcsTask } from "aws-cdk-lib/aws-events-targets";
import { Construct } from "constructs";

export interface SupportDeskProps extends StackProps { stageName: string }
export class SupportDeskStack extends Stack {
  constructor(scope: Construct, id: string, props: SupportDeskProps) {
    super(scope, id, props); Tags.of(this).add("Project", "SupportDesk"); Tags.of(this).add("Environment", props.stageName);
    const isProduction = props.stageName === "production"; const minTasks = Number(this.node.tryGetContext("minApiTasks") ?? (isProduction ? 2 : 1)); const maxTasks = Number(this.node.tryGetContext("maxApiTasks") ?? (isProduction ? 4 : 1));
    const vpc = new Vpc(this, "Vpc", { maxAzs: 2, natGateways: 0, subnetConfiguration: [{ name: "public", subnetType: SubnetType.PUBLIC, cidrMask: 24 }, { name: "database", subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 24 }] });
    const certificateArn = this.node.tryGetContext("certificateArn") as string | undefined;
    const albPort = certificateArn ? 443 : 80;
    const albSg = new SecurityGroup(this, "AlbSecurityGroup", { vpc, allowAllOutbound: true });
    const vpcLinkSg = certificateArn ? undefined : new SecurityGroup(this, "ApiGatewayVpcLinkSecurityGroup", { vpc, allowAllOutbound: true });
    albSg.addIngressRule(certificateArn ? Peer.anyIpv4() : vpcLinkSg!, Port.tcp(albPort), certificateArn ? "Public HTTPS API ingress" : "Only API Gateway VPC Link may reach ALB");
    const apiSg = new SecurityGroup(this, "ApiSecurityGroup", { vpc, allowAllOutbound: true }); apiSg.addIngressRule(albSg, Port.tcp(4000), "Only ALB may reach API");
    const dbSg = new SecurityGroup(this, "DatabaseSecurityGroup", { vpc, allowAllOutbound: false }); dbSg.addIngressRule(apiSg, Port.tcp(5432), "API and workers");
    const dbSecret = new Secret(this, "DatabaseCredentials", { generateSecretString: { secretStringTemplate: JSON.stringify({ username: "supportdesk" }), generateStringKey: "password", excludePunctuation: true } });
    const demoPassword = isProduction ? undefined : new Secret(this, "DemoPassword", { generateSecretString: { passwordLength: 24, excludePunctuation: true } });
    const database = new DatabaseInstance(this, "Database", { vpc, vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED }, securityGroups: [dbSg], engine: DatabaseInstanceEngine.postgres({ version: PostgresEngineVersion.VER_17_6 }), instanceType: InstanceType.of(isProduction ? InstanceClass.M5 : InstanceClass.BURSTABLE4_GRAVITON, isProduction ? InstanceSize.LARGE : InstanceSize.MICRO), credentials: Credentials.fromSecret(dbSecret), databaseName: "supportdesk", allocatedStorage: 20, maxAllocatedStorage: 100, storageEncrypted: true, backupRetention: Duration.days(7), deletionProtection: isProduction, multiAz: isProduction, publiclyAccessible: false, removalPolicy: isProduction ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY });
    const attachments = new Bucket(this, "Attachments", { encryption: BucketEncryption.S3_MANAGED, blockPublicAccess: BlockPublicAccess.BLOCK_ALL, enforceSSL: true, versioned: isProduction, lifecycleRules: [{ id: "abort-uploads", abortIncompleteMultipartUploadAfter: Duration.days(1) }], removalPolicy: isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY, autoDeleteObjects: !isProduction, cors: [{ allowedOrigins: [this.node.tryGetContext("webOrigin") ?? "http://localhost:3000"], allowedMethods: [HttpMethods.POST, HttpMethods.GET], allowedHeaders: ["*"], maxAge: 600 }] });
    const deadLetters = new Queue(this, "DeadLetters", { retentionPeriod: Duration.days(14), encryption: undefined });
    const jobs = new Queue(this, "Jobs", { visibilityTimeout: Duration.seconds(60), retentionPeriod: Duration.days(4), deadLetterQueue: { queue: deadLetters, maxReceiveCount: 5 } });
    const cluster = new Cluster(this, "Cluster", { vpc, containerInsightsV2: isProduction ? ContainerInsights.ENHANCED : ContainerInsights.DISABLED });
    const repository = new Repository(this, "Repository", { imageScanOnPush: true, lifecycleRules: [{ maxImageCount: 20 }], removalPolicy: isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY, emptyOnDelete: !isProduction });
    const workerRepository = new Repository(this, "WorkerRepository", { imageScanOnPush: true, lifecycleRules: [{ maxImageCount: 20 }], removalPolicy: isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY, emptyOnDelete: !isProduction });
    const logs = new LogGroup(this, "ApiLogs", { retention: RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY });
    const task = new FargateTaskDefinition(this, "ApiTask", { cpu: 512, memoryLimitMiB: 1024, runtimePlatform: { operatingSystemFamily: OperatingSystemFamily.LINUX, cpuArchitecture: CpuArchitecture.ARM64 } });
    task.addToTaskRolePolicy(new PolicyStatement({ effect: Effect.ALLOW, actions: ["s3:GetObject", "s3:PutObject", "s3:HeadObject"], resources: [`${attachments.bucketArn}/*`] }));
    const api = task.addContainer("Api", { image: ContainerImage.fromEcrRepository(repository, this.node.tryGetContext("imageTag") ?? "latest"), logging: LogDrivers.awsLogs({ logGroup: logs, streamPrefix: "api", mode: AwsLogDriverMode.NON_BLOCKING }), environment: { NODE_ENV: "production", API_PORT: "4000", AWS_REGION: this.region, ATTACHMENTS_BUCKET: attachments.bucketName, WEB_ORIGIN: this.node.tryGetContext("webOrigin") ?? "https://app.example.com", DB_HOST: database.dbInstanceEndpointAddress, DB_PORT: database.dbInstanceEndpointPort, DB_NAME: "supportdesk", DB_SSL: "true" }, secrets: { DB_USER: EcsSecret.fromSecretsManager(dbSecret, "username"), DB_PASSWORD: EcsSecret.fromSecretsManager(dbSecret, "password") }, healthCheck: { command: ["CMD-SHELL", "wget -qO- http://localhost:4000/health/live || exit 1"], interval: Duration.seconds(30), timeout: Duration.seconds(5), retries: 3, startPeriod: Duration.seconds(20) } });
    api.addPortMappings({ containerPort: 4000 }); attachments.grantReadWrite(task.taskRole); dbSecret.grantRead(task.taskRole);
    const migrateTask = new FargateTaskDefinition(this, "MigrateTask", { cpu: 256, memoryLimitMiB: 512, runtimePlatform: { operatingSystemFamily: OperatingSystemFamily.LINUX, cpuArchitecture: CpuArchitecture.ARM64 } });
    migrateTask.addContainer("Migrate", { image: ContainerImage.fromEcrRepository(repository, this.node.tryGetContext("imageTag") ?? "latest"), command: ["/app/packages/database/node_modules/.bin/tsx", "/app/packages/database/src/migrate.ts"], logging: LogDrivers.awsLogs({ logGroup: logs, streamPrefix: "migrate", mode: AwsLogDriverMode.NON_BLOCKING }), environment: { NODE_ENV: "production", DB_HOST: database.dbInstanceEndpointAddress, DB_PORT: database.dbInstanceEndpointPort, DB_NAME: "supportdesk", DB_SSL: "true" }, secrets: { DB_USER: EcsSecret.fromSecretsManager(dbSecret, "username"), DB_PASSWORD: EcsSecret.fromSecretsManager(dbSecret, "password") } });
    // Daily: delete uploads still unused after CLEANUP_AFTER_DAYS (never-attached ticket and reply images, unreferenced article images, unfinished attachments).
    const cleanupTask = new FargateTaskDefinition(this, "UploadCleanupTask", { cpu: 256, memoryLimitMiB: 512, runtimePlatform: { operatingSystemFamily: OperatingSystemFamily.LINUX, cpuArchitecture: CpuArchitecture.ARM64 } });
    cleanupTask.addContainer("UploadCleanup", { image: ContainerImage.fromEcrRepository(repository, this.node.tryGetContext("imageTag") ?? "latest"), command: ["node", "apps/api/dist/cleanup-job.js"], logging: LogDrivers.awsLogs({ logGroup: logs, streamPrefix: "cleanup", mode: AwsLogDriverMode.NON_BLOCKING }), environment: { NODE_ENV: "production", AWS_REGION: this.region, ATTACHMENTS_BUCKET: attachments.bucketName, CLEANUP_AFTER_DAYS: String(this.node.tryGetContext("uploadCleanupDays") ?? 60), DB_HOST: database.dbInstanceEndpointAddress, DB_PORT: database.dbInstanceEndpointPort, DB_NAME: "supportdesk", DB_SSL: "true" }, secrets: { DB_USER: EcsSecret.fromSecretsManager(dbSecret, "username"), DB_PASSWORD: EcsSecret.fromSecretsManager(dbSecret, "password") } });
    attachments.grantDelete(cleanupTask.taskRole);
    new Rule(this, "UploadCleanupSchedule", { description: "Delete unused uploads daily", schedule: Schedule.cron({ minute: "30", hour: "3" }), targets: [new EcsTask({ cluster, taskDefinition: cleanupTask, subnetSelection: { subnetType: SubnetType.PUBLIC }, securityGroups: [apiSg], assignPublicIp: true })] });
    if (demoPassword) {
      const maintenanceTask = new FargateTaskDefinition(this, "MaintenanceTask", { cpu: 256, memoryLimitMiB: 512, runtimePlatform: { operatingSystemFamily: OperatingSystemFamily.LINUX, cpuArchitecture: CpuArchitecture.ARM64 } });
      maintenanceTask.addContainer("Maintenance", { image: ContainerImage.fromEcrRepository(repository, this.node.tryGetContext("imageTag") ?? "latest"), command: ["/app/packages/database/node_modules/.bin/tsx", "/app/packages/database/src/seed.ts"], logging: LogDrivers.awsLogs({ logGroup: logs, streamPrefix: "maintenance", mode: AwsLogDriverMode.NON_BLOCKING }), environment: { NODE_ENV: "production", DB_HOST: database.dbInstanceEndpointAddress, DB_PORT: database.dbInstanceEndpointPort, DB_NAME: "supportdesk", DB_SSL: "true" }, secrets: { DB_USER: EcsSecret.fromSecretsManager(dbSecret, "username"), DB_PASSWORD: EcsSecret.fromSecretsManager(dbSecret, "password"), SEED_PASSWORD: EcsSecret.fromSecretsManager(demoPassword) } });
      new CfnOutput(this, "MaintenanceTaskArn", { value: maintenanceTask.taskDefinitionArn });
      new CfnOutput(this, "DemoPasswordSecretArn", { value: demoPassword.secretArn });
    }
    const service = new FargateService(this, "ApiService", { cluster, taskDefinition: task, desiredCount: minTasks, assignPublicIp: true, vpcSubnets: { subnetType: SubnetType.PUBLIC }, securityGroups: [apiSg], minHealthyPercent: minTasks > 1 ? 50 : 0, maxHealthyPercent: 200, healthCheckGracePeriod: Duration.seconds(60), circuitBreaker: { rollback: true } });
    const alb = new ApplicationLoadBalancer(this, "LoadBalancer", { vpc, internetFacing: !!certificateArn, securityGroup: albSg, vpcSubnets: { subnetType: SubnetType.PUBLIC } });
    const listener = alb.addListener("ApiListener", { port: albPort, protocol: certificateArn ? ApplicationProtocol.HTTPS : ApplicationProtocol.HTTP, certificates: certificateArn ? [Certificate.fromCertificateArn(this, "ApiCertificate", certificateArn)] : undefined, open: false });
    listener.addTargets("ApiTargets", { port: 4000, protocol: ApplicationProtocol.HTTP, targets: [service], healthCheck: { path: "/health/ready", healthyHttpCodes: "200", interval: Duration.seconds(30) }, deregistrationDelay: Duration.seconds(30) });
    const gateway = certificateArn ? undefined : new HttpApi(this, "PublicApi", { defaultIntegration: new HttpAlbIntegration("AlbIntegration", listener, { vpcLink: new VpcLink(this, "ApiGatewayVpcLink", { vpc, subnets: { subnetType: SubnetType.PUBLIC }, securityGroups: [vpcLinkSg!] }) }) });
    const scaling = service.autoScaleTaskCount({ minCapacity: minTasks, maxCapacity: maxTasks }); scaling.scaleOnCpuUtilization("CpuScaling", { targetUtilizationPercent: 60, scaleInCooldown: Duration.minutes(5), scaleOutCooldown: Duration.minutes(1) });
    const enableWorkers = this.node.tryGetContext("enableWorkers") === "true";
    for (const [workerId, workerMode] of [["OutboxPublisher", "publisher"], ["JobConsumer", "consumer"]] as const) {
      const workerTask = new FargateTaskDefinition(this, `${workerId}Task`, { cpu: 256, memoryLimitMiB: 512, runtimePlatform: { operatingSystemFamily: OperatingSystemFamily.LINUX, cpuArchitecture: CpuArchitecture.ARM64 } });
      const workerLogs = new LogGroup(this, `${workerId}Logs`, { retention: RetentionDays.ONE_WEEK, removalPolicy: isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY });
      workerTask.addContainer(workerId, { image: ContainerImage.fromEcrRepository(workerRepository, this.node.tryGetContext("workerImageTag") ?? this.node.tryGetContext("imageTag") ?? "latest"), logging: LogDrivers.awsLogs({ logGroup: workerLogs, streamPrefix: workerMode, mode: AwsLogDriverMode.NON_BLOCKING }), environment: { NODE_ENV: "production", AWS_REGION: this.region, WORKER_MODE: workerMode, SQS_QUEUE_URL: jobs.queueUrl, DB_HOST: database.dbInstanceEndpointAddress, DB_PORT: database.dbInstanceEndpointPort, DB_NAME: "supportdesk", DB_SSL: "true" }, secrets: { DB_USER: EcsSecret.fromSecretsManager(dbSecret, "username"), DB_PASSWORD: EcsSecret.fromSecretsManager(dbSecret, "password") } });
      dbSecret.grantRead(workerTask.taskRole); jobs.grantSendMessages(workerTask.taskRole); jobs.grantConsumeMessages(workerTask.taskRole);
      new FargateService(this, `${workerId}Service`, { cluster, taskDefinition: workerTask, desiredCount: enableWorkers ? 1 : 0, assignPublicIp: true, vpcSubnets: { subnetType: SubnetType.PUBLIC }, securityGroups: [apiSg], minHealthyPercent: 0, maxHealthyPercent: 200, circuitBreaker: { rollback: true } });
    }
    new Alarm(this, "Api5xxAlarm", { metric: new Metric({ namespace: "AWS/ApplicationELB", metricName: "HTTPCode_Target_5XX_Count", statistic: "sum", period: Duration.minutes(5) }), threshold: 5, evaluationPeriods: 1, comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD });
    new CfnOutput(this, "ApiUrl", { value: gateway ? gateway.url! : `https://${alb.loadBalancerDnsName}` }); new CfnOutput(this, "RepositoryUri", { value: repository.repositoryUri }); new CfnOutput(this, "WorkerRepositoryUri", { value: workerRepository.repositoryUri }); new CfnOutput(this, "AttachmentsBucket", { value: attachments.bucketName }); new CfnOutput(this, "JobsQueueUrl", { value: jobs.queueUrl }); new CfnOutput(this, "DeadLetterQueueUrl", { value: deadLetters.queueUrl }); new CfnOutput(this, "DatabaseEndpoint", { value: database.dbInstanceEndpointAddress });
    // Read by the deploy workflow to run migrations as a one-off task before the service rollout.
    new CfnOutput(this, "ClusterName", { value: cluster.clusterName }); new CfnOutput(this, "MigrateTaskFamily", { value: migrateTask.family }); new CfnOutput(this, "TaskSubnetIds", { value: vpc.publicSubnets.map((subnet) => subnet.subnetId).join(",") }); new CfnOutput(this, "TaskSecurityGroupId", { value: apiSg.securityGroupId });
  }
}
