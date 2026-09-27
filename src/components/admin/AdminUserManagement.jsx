import fr from '../../locales/fr.json';
import { PAYMENT_STATUS, getPaymentStatusShortLabel } from '../../lib/registrationOptions';
import { formatCurrency } from '../../lib/format';

// Name | email | admin | payment | amount | actions, from lg up. Below that, six columns don't
// fit without horizontal scrolling, so each party collapses into a card instead.
const GRID_COLUMNS = 'lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_4rem_9rem_7rem_auto]';

// Registered parties with their account's admin flag, payment status and amount owed.
// One markup for all screen sizes (see GRID_COLUMNS); the lg column headers replace the
// inline labels that only show on the card layout.
const AdminUserManagement = ({
  parties,
  currentUserId,
  getRoundedPartyTotal,
  onOpenUserProfile,
  onAdminToggle,
  onPaymentToggle,
  onEditParty
}) => (
  <div className="bg-white rounded-xl shadow-lg p-4 md:p-6 mb-8">
    <h2 className="text-xl font-semibold text-gray-800 mb-4 lg:mb-6">{fr.adminUsersManagementTitle}</h2>
    <div className={`hidden lg:grid ${GRID_COLUMNS} lg:gap-4 px-4 py-3 border-b border-gray-200 text-sm font-medium text-gray-700`}>
      <span>{fr.logisticsTableName}</span>
      <span>{fr.logisticsTableEmail}</span>
      <span>{fr.adminTableHeader}</span>
      <span>{fr.paymentStatus}</span>
      <span>{fr.amountDue}</span>
      <span>{fr.actionsTableHeader}</span>
    </div>
    <ul className="space-y-3 lg:space-y-0 lg:divide-y lg:divide-gray-200">
      {parties.map(party => {
        const profile = party.profiles || {};
        const isCurrentAdmin = profile.id === currentUserId;
        const isPaid = party.payment_status === PAYMENT_STATUS.PAID;
        return (
          <li
            key={party.id}
            className={`border border-gray-200 rounded-lg p-3 lg:border-0 lg:rounded-none lg:grid ${GRID_COLUMNS} lg:gap-4 lg:items-center lg:px-4 lg:py-3 text-sm text-gray-800`}
          >
            <div className="flex justify-between items-start gap-3 lg:block min-w-0">
              <button
                onClick={() => onOpenUserProfile(profile)}
                className="text-blue-600 hover:text-blue-800 hover:underline font-medium text-left py-1 lg:py-0"
              >
                {profile.full_name || fr.notSpecified}
              </button>
              <span className="font-semibold whitespace-nowrap py-1 lg:hidden">{formatCurrency(getRoundedPartyTotal(party))}</span>
            </div>
            <div className="text-gray-500 lg:text-gray-800 break-all mb-3 lg:mb-0">{profile.email}</div>
            <div className="flex items-center justify-between gap-3 mb-3 lg:contents">
              <label className="flex items-center gap-2 py-2 lg:py-0 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!profile.is_admin}
                  onChange={e => onAdminToggle(profile, e.target.checked)}
                  disabled={isCurrentAdmin}
                  aria-label={fr.adminTableHeader}
                  className="h-5 w-5 lg:h-4 lg:w-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <span className="text-gray-600 lg:hidden">{fr.adminTableHeader}</span>
              </label>
              <div>
                <button
                  onClick={() => onPaymentToggle(party, isPaid ? PAYMENT_STATUS.UNPAID : PAYMENT_STATUS.PAID)}
                  className={`px-4 py-2 text-sm lg:px-3 lg:py-1 lg:text-xs rounded-full font-medium ${
                    isPaid
                      ? 'bg-green-100 text-green-800 hover:bg-green-200'
                      : 'bg-red-100 text-red-800 hover:bg-red-200'
                  }`}
                >
                  {getPaymentStatusShortLabel(party.payment_status)}
                </button>
              </div>
            </div>
            <div className="hidden lg:block">{formatCurrency(getRoundedPartyTotal(party))}</div>
            <div>
              <button
                onClick={() => onEditParty(party)}
                className="w-full lg:w-auto px-4 py-2.5 lg:px-3 lg:py-1 border border-gray-300 text-gray-700 text-sm rounded-lg lg:rounded hover:bg-gray-50"
              >
                {fr.editRegistrationButton}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  </div>
);

export default AdminUserManagement;
