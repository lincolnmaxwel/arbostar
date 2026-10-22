// Steps of the first-login product tour (see components/ProductTour.tsx).
// A step with a `target` highlights the element carrying that
// `data-tour="<target>"` attribute; a step without one is a centered card.
// A target that is not on the page (a feature the account does not have) is
// skipped, so the tour only explains what the user can actually open.

export interface TourStep {
  id: string;
  /** Value of the `data-tour` attribute to highlight; omitted = centered card. */
  target?: string;
  /** Page this step lives on; the tour navigates there first. */
  route?: string;
  title: string;
  text: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to MyJobbs!',
    text: 'Take a quick tour (about 2 minutes) of the pages you will use most. We start with your Profile, the first thing to set up. You can skip it now and replay it anytime from the user menu.',
  },
  {
    id: 'profile-provider',
    target: 'profile-provider',
    route: '/profile',
    title: 'Service provider details',
    text: 'This is your business identity. Your logo, name, phone, email, address and GST number are printed on every quote, invoice and email your clients receive, so fill them in before you send anything.',
  },
  {
    id: 'profile-hourly',
    target: 'profile-hourly',
    route: '/profile',
    title: 'Default hourly rate',
    text: 'Enter the name of the service you provide (for example "Labor") and your hourly rate. The Timesheet uses both on every new entry and on invoices made from your timesheets. Changing the rate later does not change entries already logged.',
  },
  {
    id: 'profile-notifications',
    target: 'profile-notifications',
    route: '/profile',
    title: 'Notification email',
    text: 'Type the email that should be told when a client approves or declines a quote, or confirms a scheduled date. If you leave it blank you will not receive these notifications.',
  },
  {
    id: 'profile-password',
    target: 'profile-password',
    route: '/profile',
    title: 'Change password',
    text: 'Change your password here whenever you want: type your current password, then a new one with at least 8 characters.',
  },
  {
    id: 'nav-quotes',
    target: 'nav-quotes',
    title: 'Quotes',
    text: 'All your quotes in one list with their status: pending, approved, scheduled or completed. Open one to review it, resend it to the client or mark the job as completed.',
  },
  {
    id: 'nav-new-quote',
    target: 'nav-new-quote',
    title: 'New quote',
    text: 'Build a quote on the spot: client details, priced items and photos. It works without internet and syncs when you are back online. "Save and Send" emails the client a link to approve it.',
  },
  {
    id: 'nav-clients',
    target: 'nav-clients',
    title: 'Clients',
    text: 'Your customers and their contact details, ready to reuse on new quotes and timesheets instead of typing them again.',
  },
  {
    id: 'nav-timesheet',
    target: 'nav-timesheet',
    title: 'Timesheet',
    text: 'Log the hours and products for each job, per client, even without internet. Later, bundle the open entries into a single invoice.',
  },
  {
    id: 'nav-services',
    target: 'nav-services',
    title: 'Services',
    text: 'Your price list. Services saved here can be picked quickly on quotes and timesheets, and a product you type into a timesheet is added here automatically.',
  },
  {
    id: 'nav-invoices',
    target: 'nav-invoices',
    title: 'Invoices',
    text: 'Every invoice you issued, with its PDF. Mark each one as paid when the money arrives and send the receipt to your client.',
  },
  {
    id: 'nav-financial',
    target: 'nav-financial',
    title: 'Financial',
    text: 'Reports by day, week, month, year or any period: jobs completed, paid and outstanding, with net, GST and total separated, plus a PDF to download.',
  },
  {
    id: 'finish',
    title: "You're all set!",
    text: 'Start by filling in your Profile, then create your first quote or timesheet entry. You can replay this tour anytime from the user menu (top right) under "Product tour".',
  },
];
