import {
  INTERAC_RECIPIENT,
  INTERAC_SECURITY_ANSWER,
  INTERAC_SECURITY_QUESTION,
  interacMessage,
  interacPayerName
} from '../../supabase/functions/_shared/interac';

// #301: the module the emails and the app share.
describe('Interac payment details', () => {
  test('the recipient and the security question and answer', () => {
    expect(INTERAC_RECIPIENT).toBe('yulmixalabedaine@gmail.com');
    expect(INTERAC_SECURITY_QUESTION).toBe('Événement');
    expect(INTERAC_SECURITY_ANSWER).toBe('Bedaine');
  });

  test('the transfer message carries the name', () => {
    expect(interacMessage('Léonie Carré')).toBe('Inscription Bédaine - Léonie Carré');
  });

  test('the payer is the full name, else the first named attendee, else the email', () => {
    expect(interacPayerName('  Léonie Carré ', ['Max'], 'l@example.com')).toBe('Léonie Carré');
    expect(interacPayerName(null, ['', ' Max '], 'l@example.com')).toBe('Max');
    expect(interacPayerName('  ', [undefined], 'l@example.com')).toBe('l@example.com');
  });
});
