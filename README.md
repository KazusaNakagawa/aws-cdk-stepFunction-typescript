# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## tests

```bash
# upload test data
aws s3 cp ./test/fixtures/test.tsv.gz s3://torikomi-in 
```

## layer

```bash

mkdir -p python/lib/python3.12/site-packages
cd python/lib/python3.12/site-packages

pip install requests -t .

cd ../../../..
zip -r9 requests-layer.zip python

aws lambda publish-layer-version \
    --layer-name requests-layer \
    --description "A layer with requests library" \
    --zip-file fileb://requests-layer.zip \
    --compatible-runtimes python3.12
```

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
