import json
import gzip
import boto3
import os
import logging
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client('s3')
redshift_data_client = boto3.client('redshift-data')
sns_client = boto3.client('sns')

REDSHIFT_CLUSTER = os.getenv('REDSHIFT_CLUSTER')
REDSHIFT_DATABASE = os.getenv('REDSHIFT_DATABASE')
REDSHIFT_USER = os.getenv('REDSHIFT_USER')
REDSHIFT_PASSWORD = os.getenv('REDSHIFT_PASSWORD')
S3_OUT_BUCKET = os.getenv('S3_OUT_BUCKET')
SLACK_WEBHOOK_URL = os.getenv('SLACK_WEBHOOK_URL')

def main(event, context):

    try:
        for record in event['Records']:
            # SQSメッセージの処理
            body = json.loads(record['body'])
            s3_bucket = body['Records'][0]['s3']['bucket']['name']
            s3_key = body['Records'][0]['s3']['object']['key']

            try:
                # S3から.gzファイルをダウンロード
                download_path = f'/tmp/{os.path.basename(s3_key)}'
                s3_client.download_file(s3_bucket, s3_key, download_path)

                # 解凍
                extracted_file_path = download_path.replace('.gz', '')
                with gzip.open(download_path, 'rb') as f_in:
                    with open(extracted_file_path, 'wb') as f_out:
                        f_out.write(f_in.read())

                # Redshiftへのデータインサート
                with open(extracted_file_path, 'r') as f:
                    for line in f:
                        name, email, age = line.strip().split('\t')
                        sql = f"INSERT INTO your_table_name (name, email, age) VALUES ('{name}', '{email}', {age})"
                        response = redshift_data_client.execute_statement(
                            ClusterIdentifier=REDSHIFT_CLUSTER,
                            Database=REDSHIFT_DATABASE,
                            DbUser=REDSHIFT_USER,
                            Sql=sql
                        )

                # 成功した場合、ファイルを別のS3バケットにコピー
                s3_client.upload_file(extracted_file_path, S3_OUT_BUCKET, os.path.basename(extracted_file_path))

                # 処理完了通知
                sns_client.publish(
                    TopicArn='your-sns-topic-arn',
                    Message='Data processing completed successfully',
                    Subject='Processing Complete'
                )
            except Exception as e:
                logger.error(f"Error processing file {s3_key}: {str(e)}")
                # Slackにエラー通知
                notify_slack(f"Error processing file {s3_key}: {str(e)}")
    except Exception as e:
        logger.error(f"Error processing main: {str(e)}")
        # Slackにエラー通知
        notify_slack(f"Error processing: main {str(e)}")

def notify_slack(message):
    import requests
    payload = {
        "text": message
    }
    response = requests.post(SLACK_WEBHOOK_URL, data=json.dumps(payload),
                             headers={'Content-Type': 'application/json'})
    if response.status_code != 200:
        raise ValueError(f"Request to Slack returned an error {response.status_code}, the response is:\n{response.text}")
