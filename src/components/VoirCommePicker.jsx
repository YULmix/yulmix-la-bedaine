import { useEffect, useState } from 'react';
import fr from '../locales/fr.json';
import { supabase } from '../lib/supabase';
import { canViewAs, listViewableAccounts, openVoirComme } from '../lib/voirComme';
import AccountPicker from './AccountPicker';
import { Dialog } from './ui';

// The header's « Voir comme… » (#267, admins only): the shared account picker (#269) on every live
// account, with its level on the active edition. Admin rows and one's own are listed but can't be
// chosen; the `impersonate` function refuses them anyway. Choosing one opens the « Voir comme » tab.
const VoirCommePicker = ({ open, onClose, currentUserId }) => {
  const [state, setState] = useState({ loading: true, error: false, accounts: [] });

  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    setState(previous => ({ ...previous, loading: true, error: false }));
    listViewableAccounts(supabase)
      .then(accounts => { if (current) setState({ loading: false, error: false, accounts }); })
      .catch(() => { if (current) setState({ loading: false, error: true, accounts: [] }); });
    return () => { current = false; };
  }, [open]);

  const choose = (account) => {
    openVoirComme(account.id);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={fr.voirCommePickerTitle} size="md">
      <div className="space-y-4 p-5 sm:p-6">
        <p className="text-sm text-muted">{fr.voirCommePickerIntro}</p>
        <AccountPicker
          accounts={state.accounts}
          loading={state.loading}
          error={state.error}
          isCurrent={account => account.id === currentUserId}
          isDisabled={account => !canViewAs({ ...account, deleted_at: null }, currentUserId)}
          onChoose={choose}
        />
      </div>
    </Dialog>
  );
};

export default VoirCommePicker;
