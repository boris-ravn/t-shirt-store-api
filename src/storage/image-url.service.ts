import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Builds the public URL from the stored s3_key at response time, so the
// stored data stays decoupled from infrastructure (bucket, region, CDN).
@Injectable()
export class ImageUrlService {
  constructor(private readonly configService: ConfigService) {}

  buildUrl(s3Key: string): string {
    const bucket = this.configService.getOrThrow<string>('AWS_S3_BUCKET');
    const region = this.configService.getOrThrow<string>('AWS_REGION');
    return `https://${bucket}.s3.${region}.amazonaws.com/${s3Key}`;
  }
}
