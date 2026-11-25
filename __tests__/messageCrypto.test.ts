import nacl from 'tweetnacl';
import {
  decryptAttachmentBytes,
  decryptMessage,
  encryptAttachmentBytes,
  encryptMessage,
} from '../src/services/messageCrypto';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('end-to-end message encryption', () => {
  it('lets only the sender and intended recipient open the encrypted copies', () => {
    nacl.setPRNG((bytes, length) => {
      for (let index = 0; index < length; index += 1) {
        bytes[index] = (index * 37 + length) % 256;
      }
    });
    const sender = nacl.box.keyPair.fromSecretKey(
      Uint8Array.from({ length: nacl.box.secretKeyLength }, (_, index) => index + 1),
    );
    const recipient = nacl.box.keyPair.fromSecretKey(
      Uint8Array.from({ length: nacl.box.secretKeyLength }, (_, index) => index + 101),
    );
    const senderIdentity = {
      publicKey: toHex(sender.publicKey),
      secretKey: toHex(sender.secretKey),
    };

    const encrypted = encryptMessage(
      'Kunjani 🌍',
      senderIdentity,
      toHex(recipient.publicKey),
    );

    expect(
      decryptMessage(encrypted.senderCiphertext, encrypted.nonce, senderIdentity.publicKey, senderIdentity.secretKey),
    ).toBe('Kunjani 🌍');
    expect(
      decryptMessage(encrypted.recipientCiphertext, encrypted.nonce, senderIdentity.publicKey, toHex(recipient.secretKey)),
    ).toBe('Kunjani 🌍');
    expect(() =>
      decryptMessage(encrypted.recipientCiphertext, encrypted.nonce, senderIdentity.publicKey, senderIdentity.secretKey),
    ).toThrow('This message could not be decrypted with the device key.');
  });

  it('encrypts binary attachments and rejects altered ciphertext', () => {
    const plaintext = Uint8Array.from([0, 1, 2, 128, 255]);
    const encrypted = encryptAttachmentBytes(plaintext);

    expect(decryptAttachmentBytes(encrypted.ciphertext, encrypted.nonce, encrypted.key)).toEqual(plaintext);
    encrypted.ciphertext[0] = ((encrypted.ciphertext[0] ?? 0) + 1) % 256;
    expect(() =>
      decryptAttachmentBytes(encrypted.ciphertext, encrypted.nonce, encrypted.key),
    ).toThrow('This attachment could not be decrypted.');
  });
});
