import { NextRequest, NextResponse } from 'next/server';
import { requireUserScope, UnauthorizedError } from '@/lib/userScope';
import { isFeatureEnabled, featureDisabledResponse } from '@/lib/features';
import { getCompanyProfile } from '@/lib/companyProfile';
import { getFinancialSummary, periodFromSearchParams } from '@/lib/financial';
import { buildFinancialReportPdf } from '@/lib/financialPdf';

export async function GET(req: NextRequest) {
  let scope;
  try {
    scope = await requireUserScope();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw err;
  }

  if (!(await isFeatureEnabled(scope.ownerUserId, 'invoices'))) {
    return featureDisabledResponse();
  }

  const period = periodFromSearchParams(req.nextUrl.searchParams);
  if ('error' in period) return NextResponse.json({ error: period.error }, { status: 400 });

  const [summary, company] = await Promise.all([
    getFinancialSummary(scope.ownerUserId, period),
    getCompanyProfile(scope.ownerUserId),
  ]);

  const pdf = await buildFinancialReportPdf({
    summary,
    company: { name: company.name, phone: company.phone, email: company.email, address: company.address, gstNumber: company.gstNumber, logoPath: company.logoPath },
    generatedAt: new Date(),
  });

  const stamp = summary.period.from.slice(0, 10);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="financial-report-${period.preset}-${stamp}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
