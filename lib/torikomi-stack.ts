import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as s3_notifications from 'aws-cdk-lib/aws-s3-notifications';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as stepfunctions_tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';

// SLACK_WEBHOOK_URLを .env から読み込む
require('dotenv').config();


export class TorikomiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 既存の S3 バケットを参照する場合
    const torikomiInBucket = s3.Bucket.fromBucketName(this, 'TorikomiInBucket', 'torikomi-in');
    const torikomiOutBucket = s3.Bucket.fromBucketName(this, 'TorikomiOutBucket', 'torikomi-out');

    // SQS キューの定義
    const queue = new sqs.Queue(this, 'TorikomiQueue');
    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!slackWebhookUrl) {
      throw new Error('SLACK_WEBHOOK_URL is not defined in the .env file');
    }

    // SNS トピックの定義
    const snsTopic = new sns.Topic(this, 'TorikomiSnsTopic');
    snsTopic.addSubscription(new sns_subscriptions.EmailSubscription('test@gmail.com'));

    // S3バケットにアップロードされたらSQSキューに通知する
    torikomiInBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED, 
      new s3_notifications.SqsDestination(queue),
      { suffix: '.tsv.gz' }
    );

    // 作成したレイヤーをLambda関数に追加
    const requestsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this, 'RequestsLayer',
      `arn:aws:lambda:${process.env.CDK_DEFAULT_REGION}:${process.env.CDK_DEFAULT_ACCOUNT}:layer:requests-layer:1`
    );
    // Lambda 関数を定義
    const processLambda = new lambda.Function(this, 'ProcessLambda', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.main',
      code: lambda.Code.fromAsset('lambda/process'),
      functionName: 'torikomi-process',
      layers: [requestsLayer],
      environment: {
        REDSHIFT_CLUSTER: 'your-redshift-cluster',
        REDSHIFT_DATABASE: 'your-database',
        REDSHIFT_USER: 'your-username',
        REDSHIFT_PASSWORD: 'your-password',
        S3_OUT_BUCKET: torikomiOutBucket.bucketName,
        SLACK_WEBHOOK_URL: slackWebhookUrl,
      },
    });

    // Lambda に必要な権限を付与
    torikomiInBucket.grantRead(processLambda);
    torikomiOutBucket.grantWrite(processLambda);
    processLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['redshift-data:ExecuteStatement'],
      resources: ['*'],
    }));

    // Step Function の定義
    const processTsvTask = new stepfunctions_tasks.LambdaInvoke(this, 'ProcessTSV', {
      lambdaFunction: processLambda,
      outputPath: '$.Payload',
    });

    const definition = processTsvTask;

    const stateMachine = new stepfunctions.StateMachine(this, 'TorikomiStateMachine', {
      definition,
    });

    // EventBridge ルールの定義
    const rule = new events.Rule(this, 'ScheduleRule', {
      // schedule: events.Schedule.cron({ minute: '0/30', hour: '10-18', weekDay: 'MON-FRI' }),
      schedule: events.Schedule.cron({ minute: '0/10'}),
      enabled: false,
    });
    // EventBridgeルールのターゲットにLambda関数を追加
    rule.addTarget(new targets.LambdaFunction(processLambda));

    // rule.addTarget(new targets.SfnStateMachine(stateMachine, {
    //   input: events.RuleTargetInput.fromObject({
    //     queueUrl: queue.queueUrl,
    //   }),
    // }));

    // SNS 通知を Lambda から行うための権限付与
    snsTopic.grantPublish(processLambda);

    // CDK出力
    new cdk.CfnOutput(this, 'TorikomiInBucketName', { value: torikomiInBucket.bucketName });
    new cdk.CfnOutput(this, 'TorikomiOutBucketName', { value: torikomiOutBucket.bucketName });
    new cdk.CfnOutput(this, 'QueueUrl', { value: queue.queueUrl });
  }
}
