import PDFDocument from 'pdfkit';
import { readFile } from 'fs/promises';
import path from 'path';
import { formatMoney } from '@/lib/quoteMath';

export interface InvoicePdfItem {
  title: string;
  description?: string | null;
  price: number;
}

export interface InvoicePdfOptions {
  invoiceNumber: number;
  quoteNumber: number;
  date: Date;
  client: { name: string; email?: string | null; phone?: string | null; address?: string | null };
  serviceAddress?: string | null;
  company: { name?: string | null; phone?: string | null; email?: string | null; address?: string | null; logoPath?: string | null };
  items: InvoicePdfItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}

const PRIMARY = '#2c5f2d';
const GRAY = '#6b7280';
const DARK = '#111827';
const BORDER = '#d1d5db';

// A4 in points (PDFKit's 'A4' size does this already, but spelled out since
// every coordinate below is derived from it) — the on-screen /invoices/[id]
// page is the source of layout truth; this mirrors it in a format that
// prints predictably on paper, which HTML/CSS in an email client can't
// guarantee.
export async function buildInvoicePdf(opts: InvoicePdfOptions): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const pageWidth = doc.page.width;
  const marginX = doc.page.margins.left;
  const contentWidth = pageWidth - marginX * 2;

  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(22).text(`Invoice #${opts.invoiceNumber}`, marginX, 50);
  doc.fillColor(GRAY).font('Helvetica').fontSize(9).text(`Quote #${opts.quoteNumber} · ${opts.date.toLocaleDateString()}`, marginX, 78);

  if (opts.company.logoPath) {
    try {
      const logoBuffer = await readFile(path.join(process.cwd(), 'uploads', 'company', opts.company.logoPath));
      doc.image(logoBuffer, pageWidth - marginX - 100, 45, { fit: [100, 60] });
    } catch {
      // Logo file missing on disk — skip it rather than fail the whole PDF.
    }
  }

  let y = 122;
  doc.moveTo(marginX, y).lineTo(pageWidth - marginX, y).strokeColor(BORDER).stroke();
  y += 22;

  const colWidth = contentWidth / 2 - 12;
  const toX = marginX;
  const fromX = marginX + contentWidth / 2 + 12;

  doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY).text('TO', toX, y);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY).text('FROM', fromX, y);
  const partiesTop = y + 14;

  let toY = partiesTop;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK).text(opts.client.name, toX, toY, { width: colWidth });
  toY += 16;
  doc.font('Helvetica').fontSize(9).fillColor(GRAY);
  const toLines = [
    opts.client.email,
    opts.client.phone,
    opts.client.address,
    opts.serviceAddress ? `Service address: ${opts.serviceAddress}` : null,
  ].filter((line): line is string => !!line);
  for (const line of toLines) {
    doc.text(line, toX, toY, { width: colWidth });
    toY += doc.heightOfString(line, { width: colWidth }) + 3;
  }

  let fromY = partiesTop;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK).text(opts.company.name || '', fromX, fromY, { width: colWidth });
  fromY += 16;
  doc.font('Helvetica').fontSize(9).fillColor(GRAY);
  const fromLines = [opts.company.phone, opts.company.email, opts.company.address].filter((line): line is string => !!line);
  for (const line of fromLines) {
    doc.text(line, fromX, fromY, { width: colWidth });
    fromY += doc.heightOfString(line, { width: colWidth }) + 3;
  }

  y = Math.max(toY, fromY) + 20;

  const totalColWidth = 90;
  const descColWidth = contentWidth - totalColWidth - 8;

  doc.rect(marginX, y, contentWidth, 22).fill(PRIMARY);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
  doc.text('DESCRIPTION', marginX + 8, y + 7);
  doc.text('TOTAL', marginX + 8 + descColWidth, y + 7, { width: totalColWidth, align: 'right' });
  y += 22;

  for (const item of opts.items) {
    const rowTop = y + 10;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text(item.title, marginX + 8, rowTop, { width: descColWidth });
    let textBottom = rowTop + doc.heightOfString(item.title, { width: descColWidth });
    if (item.description) {
      const descY = textBottom + 4;
      doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(item.description, marginX + 8, descY, { width: descColWidth });
      textBottom = descY + doc.heightOfString(item.description, { width: descColWidth });
    }
    doc.font('Helvetica').fontSize(10).fillColor(DARK).text(formatMoney(item.price), marginX + 8 + descColWidth, rowTop, {
      width: totalColWidth,
      align: 'right',
    });
    y = textBottom + 12;
    doc.moveTo(marginX, y).lineTo(pageWidth - marginX, y).strokeColor(BORDER).stroke();
    y += 6;
  }

  y += 14;

  const totalsWidth = 220;
  const totalsX = pageWidth - marginX - totalsWidth;
  const totalsLabelWidth = totalsWidth - 100;

  function totalsRow(label: string, value: string, bold: boolean) {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10).fillColor(bold ? DARK : GRAY);
    doc.text(label, totalsX, y, { width: totalsLabelWidth });
    doc.text(value, totalsX + totalsLabelWidth, y, { width: 100, align: 'right' });
    y += bold ? 22 : 16;
  }

  totalsRow('Subtotal', formatMoney(opts.subtotal), false);
  totalsRow(`Tax (${(opts.taxRate * 100).toFixed(1)}%)`, formatMoney(opts.taxAmount), false);
  doc.moveTo(totalsX, y).lineTo(totalsX + totalsWidth, y).strokeColor(BORDER).stroke();
  y += 8;
  totalsRow('Total', formatMoney(opts.total), true);

  y += 40;
  doc.font('Helvetica').fontSize(10).fillColor(GRAY).text(
    `Thank you for your business${opts.company.name ? ` with ${opts.company.name}` : ''}!`,
    marginX,
    y,
    { width: contentWidth, align: 'center' },
  );

  doc.end();
  return finished;
}
