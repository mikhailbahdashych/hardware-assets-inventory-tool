import type { OpenApiDocument } from '@/types/openapi';
import type { DocOperation } from './spec';

export interface OperationCardProps {
  spec: OpenApiDocument;
  entry: DocOperation;
}
