import { Injectable } from '@angular/core';
import * as QRCode from 'qrcode';

/** Thin injectable wrapper so components (and their tests) never touch the lib directly. */
@Injectable({ providedIn: 'root' })
export class QrService {
  toDataUrl(text: string): Promise<string> {
    return QRCode.toDataURL(text, { margin: 1, width: 220 });
  }
}
