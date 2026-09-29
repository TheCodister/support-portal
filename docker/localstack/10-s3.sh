#!/bin/sh
set -eu
awslocal s3api create-bucket --bucket supportdesk-local
awslocal s3api put-bucket-cors --bucket supportdesk-local --cors-configuration '{"CORSRules":[{"AllowedOrigins":["http://localhost:3000"],"AllowedMethods":["GET","POST","PUT","HEAD"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":600}]}'
