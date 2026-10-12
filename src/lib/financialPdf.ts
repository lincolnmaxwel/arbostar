import PDFDocument from 'pdfkit';
import { readFile } from 'fs/promises';
import path from 'path';
import { formatMoney } from '@/lib/quoteMath';
import type { FinancialSummary, MoneyBreakdown } from '@/lib/financial';

export interface FinancialPdfOptions {
  summary: FinancialSummary;
  company: { name?: string | null; phone?: string | null; email?: string | null; address?: string | null; gstNumber?: string | null; logoPath?: string | null };
  generatedAt: Date;
}

const PRIMARY = '#075bff';
const PRIMARY_LIGHT = '#e8f0ff';
const GRAY = '#6b7280';
const DARK = '#111827';
const BORDER = '#d1d5db';
const PAID = '#15803d';
const PENDING = '#b45309';

const PERIOD_TITLE: Record<string, string> = {
  daily: 'Daily report',
  weekly: 'Weekly report',
  monthly: 'Monthly report',
  yearly: 'Annual report',
  custom: 'Custom period report',
};

export async function buildFinancialReportPdf(opts: FinancialPdfOptions): Promise<Buffer> {
  const { summary, company } = opts;
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const pageWidth = doc.page.width;
  const pageBottom = doc.page.height - 70;
  const marginX = doc.page.margins.left;
  const contentWidth = pageWidth - marginX * 2;

  // ---- Header: logo + company on the left, report identity on the right ----
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(22).text('Financial Report', marginX, 50, { width: contentWidth, align: 'right' });
  doc.fillColor(GRAY).font('Helvetica').fontSize(10).text(PERIOD_TITLE[summary.period.preset] ?? 'Report', marginX, 78, { width: contentWidth, align: 'right' });
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11).text(summary.period.label, marginX, 93, { width: contentWidth, align: 'right' });

  let leftY = 50;
  let hasLogo = false;
  if (company.logoPath) {
    try {
      const logo = await readFile(path.join(process.cwd(), 'uploads', 'company', company.logoPath));
      doc.image(logo, marginX, 45, { fit: [100, 60] });
      hasLogo = true;
    } catch {
      // Missing logo file — skip it rather than fail the report.
    }
  }
  if (hasLogo) leftY = 112;
  const companyLines = [company.name, company.phone, company.email, company.address, company.gstNumber ? `GST #: ${company.gstNumber}` : null].filter(
    (l): l is string => !!l,
  );
  if (companyLines.length > 0 && !hasLogo) {
    doc.font('Helvetica-Bold').fontSize(12).fillColor(DARK).text(companyLines[0], marginX, leftY, { width: contentWidth / 2 });
    leftY = doc.y + 2;
    doc.font('Helvetica').fontSize(9).fillColor(GRAY);
    for (const line of companyLines.slice(1)) {
      doc.text(line, marginX, leftY, { width: contentWidth / 2 });
      leftY = doc.y + 1;
    }
  }

  let y = Math.max(leftY, 118) + 12;
  doc.moveTo(marginX, y).lineTo(pageWidth - marginX, y).strokeColor(BORDER).stroke();
  y += 18;

  // ---- Jobs summary: four KPI tiles ----
  const tileGap = 10;
  const tileWidth = (contentWidth - tileGap * 3) / 4;
  const tiles: { label: string; value: string }[] = [
    { label: 'JOBS COMPLETED', value: String(summary.jobs.completed) },
    { label: 'PAID', value: String(summary.jobs.paid) },
    { label: 'AWAITING PAYMENT', value: String(summary.jobs.unpaid) },
    { label: 'SCHEDULED (OPEN)', value: String(summary.jobs.scheduledOpen) },
  ];
  tiles.forEach((tile, i) => {
    const x = marginX + i * (tileWidth + tileGap);
    doc.roundedRect(x, y, tileWidth, 52, 6).fill(PRIMARY_LIGHT);
    doc.fillColor(GRAY).font('Helvetica-Bold').fontSize(7).text(tile.label, x + 10, y + 10, { width: tileWidth - 20 });
    doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(20).text(tile.value, x + 10, y + 24, { width: tileWidth - 20 });
  });
  y += 52 + 6;
  doc.fillColor(GRAY).font('Helvetica').fontSize(8).text(
    `${summary.jobs.completedQuotes} from quotes · ${summary.jobs.timesheetInvoices} from timesheets. "Scheduled (open)" is the current count of approved jobs not yet completed.`,
    marginX,
    y,
    { width: contentWidth },
  );
  y = doc.y + 18;

  // ---- Money table: net / GST / total, per category ----
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(12).text('Revenue', marginX, y);
  y += 20;

  const labelW = contentWidth - 3 * 100;
  const colX = [marginX + labelW, marginX + labelW + 100, marginX + labelW + 200];
  doc.rect(marginX, y, contentWidth, 22).fill(PRIMARY);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
  doc.text('NET (BEFORE GST)', colX[0], y + 7, { width: 92, align: 'right' });
  doc.text('GST', colX[1], y + 7, { width: 92, align: 'right' });
  doc.text('TOTAL (WITH GST)', colX[2], y + 7, { width: 92, align: 'right' });
  y += 22;

  const moneyRows: { label: string; hint: string; data: MoneyBreakdown; color: string; bold?: boolean }[] = [
    { label: 'Invoiced', hint: 'All invoices issued in the period', data: summary.invoiced, color: DARK, bold: true },
    { label: 'Received', hint: 'Paid invoices', data: summary.received, color: PAID },
    { label: 'Outstanding', hint: 'Awaiting payment', data: summary.outstanding, color: PENDING },
    { label: 'Scheduled work', hint: 'Approved, not yet completed (current)', data: summary.scheduledValue, color: GRAY },
  ];
  for (const row of moneyRows) {
    doc.fillColor(row.color).font('Helvetica-Bold').fontSize(10).text(row.label, marginX + 8, y + 9, { width: labelW - 8 });
    doc.fillColor(GRAY).font('Helvetica').fontSize(8).text(row.hint, marginX + 8, y + 23, { width: labelW - 8 });
    doc.fillColor(row.color).font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
    doc.text(formatMoney(row.data.net), colX[0], y + 9, { width: 92, align: 'right' });
    doc.text(formatMoney(row.data.gst), colX[1], y + 9, { width: 92, align: 'right' });
    doc.text(formatMoney(row.data.gross), colX[2], y + 9, { width: 92, align: 'right' });
    y += 42;
    doc.moveTo(marginX, y).lineTo(pageWidth - marginX, y).strokeColor(BORDER).stroke();
  }
  y += 22;

  // ---- Invoice detail list (paginated) ----
  const cols = {
    number: marginX + 8,
    date: marginX + 62,
    client: marginX + 132,
    status: marginX + 292,
    net: marginX + 340,
    gst: marginX + 400,
    total: marginX + 450,
  };
  const widths = { number: 50, date: 66, client: 156, status: 46, net: 56, gst: 46, total: contentWidth - 450 - 8 };

  function drawListHeader() {
    doc.rect(marginX, y, contentWidth, 20).fill(PRIMARY);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
    doc.text('INVOICE', cols.number, y + 6, { width: widths.number });
    doc.text('DATE', cols.date, y + 6, { width: widths.date });
    doc.text('CLIENT', cols.client, y + 6, { width: widths.client });
    doc.text('STATUS', cols.status, y + 6, { width: widths.status });
    doc.text('NET', cols.net, y + 6, { width: widths.net, align: 'right' });
    doc.text('GST', cols.gst, y + 6, { width: widths.gst, align: 'right' });
    doc.text('TOTAL', cols.total, y + 6, { width: widths.total, align: 'right' });
    y += 20;
  }

  if (y + 90 > pageBottom) {
    doc.addPage();
    y = 50;
  }
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(12).text('Invoices in this period', marginX, y);
  y += 20;

  if (summary.invoices.length === 0) {
    doc.fillColor(GRAY).font('Helvetica').fontSize(10).text('No invoices were issued in this period.', marginX, y, { width: contentWidth });
    y = doc.y;
  } else {
    drawListHeader();
    for (const inv of summary.invoices) {
      if (y + 24 > pageBottom) {
        doc.addPage();
        y = 50;
        drawListHeader();
      }
      const rowTop = y + 7;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text(`#${inv.number}`, cols.number, rowTop, { width: widths.number });
      doc.font('Helvetica').fontSize(9).fillColor(DARK);
      doc.text(new Date(inv.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), cols.date, rowTop, { width: widths.date });
      doc.text(inv.clientName, cols.client, rowTop, { width: widths.client, height: 12, ellipsis: true, lineBreak: false });
      doc.fillColor(inv.paymentStatus === 'paid' ? PAID : PENDING).font('Helvetica-Bold').fontSize(8);
      doc.text(inv.paymentStatus === 'paid' ? 'Paid' : 'Pending', cols.status, rowTop + 1, { width: widths.status });
      doc.fillColor(DARK).font('Helvetica').fontSize(9);
      doc.text(formatMoney(inv.net), cols.net, rowTop, { width: widths.net, align: 'right' });
      doc.text(formatMoney(inv.gst), cols.gst, rowTop, { width: widths.gst, align: 'right' });
      doc.text(formatMoney(inv.gross), cols.total, rowTop, { width: widths.total, align: 'right' });
      y += 26;
      doc.moveTo(marginX, y).lineTo(pageWidth - marginX, y).strokeColor(BORDER).stroke();
    }
  }

  // ---- Footer on every page: generated-at + page x of y ----
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // Zero the bottom margin so text in the footer band doesn't trigger an
    // automatic new page.
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor(GRAY);
    doc.text(
      `Generated ${opts.generatedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`,
      marginX,
      doc.page.height - 40,
      { width: contentWidth / 2, align: 'left', lineBreak: false },
    );
    doc.text(`Page ${i + 1} of ${range.count}`, marginX + contentWidth / 2, doc.page.height - 40, {
      width: contentWidth / 2,
      align: 'right',
      lineBreak: false,
    });
  }

  doc.end();
  return finished;
}
