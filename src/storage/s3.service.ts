import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

@Injectable()
export class S3Service {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(configService: ConfigService) {
    this.bucket = configService.getOrThrow<string>('AWS_S3_BUCKET');
    // No explicit `credentials` — the SDK's default provider chain reads
    // AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY from the environment in dev,
    // and would pick up an IAM role in production with no code change.
    //
    // AWS_S3_ENDPOINT is unset against real AWS. Locally it points at the
    // MinIO container (see docker-compose.yml) — there's no real AWS
    // account for this training project — which also needs path-style
    // addressing (MinIO doesn't do virtual-hosted-style buckets).
    const endpoint = configService.get<string>('AWS_S3_ENDPOINT');
    this.client = new S3Client({
      region: configService.getOrThrow<string>('AWS_REGION'),
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
