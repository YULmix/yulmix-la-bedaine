import { render, screen, fireEvent } from '@testing-library/react';
import AccountPicker from './AccountPicker';
import fr from '../locales/fr.json';

const accounts = [
  { id: '1', email: 'admin@test.local', full_name: 'Test Admin', level: 'admin' },
  { id: '2', email: 'organiser@test.local', full_name: 'Test Organisateur', level: 'organiser' },
  { id: '3', email: 'committee@test.local', full_name: 'Test Comité', level: 'committee' },
  { id: '4', email: 'member@test.local', full_name: 'Test Member', level: 'member' }
];
const rows = () => screen.getAllByRole('listitem');

test('the level filter narrows the list, and combines with the search', () => {
  render(<AccountPicker accounts={accounts} onChoose={() => {}} />);
  expect(rows()).toHaveLength(4);
  fireEvent.click(screen.getByRole('radio', { name: fr.editionRoleOrganiser }));
  expect(rows()).toHaveLength(1);
  expect(rows()[0]).toHaveTextContent('organiser@test.local');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'member' } });
  expect(screen.getByText(fr.accountsNoMatch)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: fr.accountLevelAll }));
  expect(rows()).toHaveLength(1);
});

test('each row shows its level, and extra tags come from renderTags', () => {
  render(<AccountPicker accounts={accounts} onChoose={() => {}} renderTags={a => <span>extra {a.id}</span>} />);
  expect(rows()[0]).toHaveTextContent(fr.editionRoleAdmin);
  expect(rows()[2]).toHaveTextContent(fr.editionRoleCommittee);
  expect(rows()[3]).toHaveTextContent(fr.accountLevelMember);
  expect(rows()[3]).toHaveTextContent('extra 4');
});

test('a disabled or current row cannot be chosen; the others call onChoose', () => {
  const onChoose = jest.fn();
  render(<AccountPicker accounts={accounts} onChoose={onChoose} isDisabled={a => a.level === 'admin'} isCurrent={a => a.id === '4'} />);
  fireEvent.click(rows()[0].querySelector('button'));
  fireEvent.click(rows()[3].querySelector('button'));
  expect(onChoose).not.toHaveBeenCalled();
  expect(rows()[3]).toHaveTextContent(fr.accountCurrent);
  fireEvent.click(rows()[1].querySelector('button'));
  expect(onChoose).toHaveBeenCalledWith(accounts[1]);
});
