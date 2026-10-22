// Steps of the first-login product tour (see components/ProductTour.tsx).
// A step with a `target` highlights the element carrying that
// `data-tour="<target>"` attribute; a step without one is a centered card.
// A step whose feature the account does not have (`requires`) or whose target
// never shows up is skipped, so the tour only explains what the user can open.

export type TourFeature = 'quotes' | 'invoices' | 'timesheet' | 'clients_crm';

export interface TourStep {
  id: string;
  /** Value of the `data-tour` attribute to highlight; omitted = centered card. */
  target?: string;
  /** Page this step lives on; the tour opens it first (like clicking the menu). */
  route?: string;
  /** Menu link to point at for a moment before opening `route`. */
  via?: string;
  /** Shown only when the account has at least one of these features. */
  requires?: TourFeature[];
  /** The user may type in / click the highlighted area while the step is shown. */
  interactive?: boolean;
  /** The account dropdown must be open for the target to exist. */
  openMenu?: boolean;
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
    id: 'user-menu',
    target: 'user-menu',
    title: 'Your account menu',
    text: 'The button with your email, at the top right of every page, opens your account menu. Click it any time to reach your Profile, your Subscription and Sign out.',
  },
  {
    id: 'menu-profile',
    target: 'menu-profile',
    openMenu: true,
    title: 'Open your Profile',
    text: 'Choose Profile in this menu. Next we open it together and go through each block. You can fill the fields in right away.',
  },
  {
    id: 'profile-provider',
    target: 'profile-provider',
    route: '/profile',
    interactive: true,
    title: 'Service provider details',
    text: 'This is your business identity. Your logo, name, phone, email, address and GST number are printed on every quote, invoice and email your clients receive. Fill them in now and press Save in this block before going on.',
  },
  {
    id: 'profile-hourly',
    target: 'profile-hourly',
    route: '/profile',
    interactive: true,
    title: 'Default hourly rate',
    text: 'Enter the name of the service you provide (for example "Labor") and your hourly rate. The Timesheet uses both on every new entry and on invoices made from your timesheets. Press Save in this block before going on.',
  },
  {
    id: 'profile-notifications',
    target: 'profile-notifications',
    route: '/profile',
    interactive: true,
    title: 'Notification email',
    text: 'Type the email that should be told when a client approves or declines a quote, or confirms a scheduled date, then press Save. If you leave it blank you will not receive these notifications.',
  },
  {
    id: 'profile-password',
    target: 'profile-password',
    route: '/profile',
    interactive: true,
    title: 'Change password',
    text: 'Change your password here whenever you want: type your current password, then a new one with at least 8 characters. You can leave this for later.',
  },
  {
    id: 'page-quotes',
    target: 'page-quotes',
    route: '/quotes',
    via: 'nav-quotes',
    requires: ['quotes'],
    title: 'Quotes',
    text: 'We opened Quotes from the menu. Every quote you create is listed here with its status: pending, approved, scheduled or completed. The + New quote button starts a new one.',
  },
  {
    id: 'page-new-quote',
    target: 'page-new-quote',
    route: '/quotes/new',
    via: 'nav-new-quote',
    requires: ['quotes'],
    title: 'New quote',
    text: 'This is the quote builder. Start with the client details, then add priced items and photos. It works without internet and syncs when you are back online. "Save and Send" emails the client a link to approve it.',
  },
  {
    id: 'page-clients',
    target: 'page-clients',
    route: '/clients',
    via: 'nav-clients',
    requires: ['clients_crm', 'timesheet'],
    title: 'Clients',
    text: 'Your customers and their contact details, ready to reuse on new quotes and timesheets instead of typing them again.',
  },
  {
    id: 'page-timesheet',
    target: 'page-timesheet',
    route: '/timesheet',
    via: 'nav-timesheet',
    requires: ['timesheet'],
    title: 'Timesheet',
    text: 'Log your work here: pick the client, date and times, add products if needed and save. It works without internet. Later, bundle the open entries into a single invoice.',
  },
  {
    id: 'page-services',
    target: 'page-services',
    route: '/services',
    via: 'nav-services',
    requires: ['timesheet'],
    title: 'Services',
    text: 'Your price list: services and products with price, billing type and unit. They show up as shortcuts on quotes and timesheets, and a product you type into a timesheet is added here automatically.',
  },
  {
    id: 'page-invoices',
    target: 'page-invoices',
    route: '/invoices',
    via: 'nav-invoices',
    requires: ['invoices'],
    title: 'Invoices',
    text: 'Every invoice you issue is listed here with its PDF. Mark each one as paid when the money arrives and send the receipt to your client.',
  },
  {
    id: 'page-financial',
    target: 'page-financial',
    route: '/financial',
    via: 'nav-financial',
    requires: ['invoices'],
    title: 'Financial',
    text: 'Pick a period (day, week, month, year or custom) to see jobs completed, paid and outstanding, with net, GST and total separated. You can also download a PDF report.',
  },
  {
    id: 'finish',
    title: "You're all set!",
    text: 'Start by filling in your Profile, then create your first quote or timesheet entry. You can replay this tour anytime from the account menu (your email, top right) under "Product tour".',
  },
];
