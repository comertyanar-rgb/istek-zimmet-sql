import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, LockKeyhole, Mail, MessageSquare, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { GAS_URL } from '../config/appConfig.js';
import { encryptAdPassword } from '../utils/adPasswordCrypto.js';

function getDefaultAdUser(person) {
  if (person?.adUser) return person.adUser;
  if (person?.email && person.email.includes('@')) return person.email.split('@')[0];
  return '';
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0090')) return digits.slice(4);
  if (digits.startsWith('90') && digits.length === 12) return digits.slice(2);
  if (digits.startsWith('0')) return digits.slice(1, 11);
  return digits.slice(0, 10);
}

function isValidTrMobile(value) {
  return /^5\d{9}$/.test(normalizePhone(value));
}

function validatePassword(password, adUser, personName) {
  if (!password || password.length < 10) return 'Şifre en az 10 karakter olmalı.';
  if (/\s/.test(password)) return 'Şifre boşluk içermemeli.';
  if (!/^[\x21-\x7E]+$/.test(password)) return 'Şifre Türkçe karakter veya görünmeyen karakter içermemeli.';

  if (!/[A-Z]/.test(password)) return 'Şifre en az 1 büyük harf içermeli.';
  if (!/[a-z]/.test(password)) return 'Şifre en az 1 küçük harf içermeli.';
  if (!/\d/.test(password)) return 'Şifre en az 1 rakam içermeli.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Şifre en az 1 özel karakter içermeli.';

  const lower = password.toLocaleLowerCase('tr-TR');
  const adLower = (adUser || '').toLocaleLowerCase('tr-TR');
  if (adLower && lower.includes(adLower)) return 'Şifre AD kullanıcı adını içermemeli.';

  const nameParts = String(personName || '')
    .toLocaleLowerCase('tr-TR')
    .split(/\s+/)
    .filter((part) => part.length >= 4);

  if (nameParts.some((part) => lower.includes(part))) {
    return 'Şifre personelin ad/soyad bilgisini içermemeli.';
  }

  return '';
}

export function AdPasswordResetModal({ person, currentUser, clientIp, onClose, onQueued, onPhoneSaved }) {
  const [mode, setMode] = useState('PERMANENT');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [notifySms, setNotifySms] = useState(false);
  const [phone, setPhone] = useState(person?.phone || '');
  const [phoneConfirmed, setPhoneConfirmed] = useState(false);

  const adUser = useMemo(() => getDefaultAdUser(person), [person]);
  const passwordError = validatePassword(password, adUser, person?.name);
  const smsReady = !notifySms || (isValidTrMobile(phone) && phoneConfirmed);
  const modeLabel = mode === 'TEMPORARY' ? 'Geçici' : 'Kalıcı';
  const disabledReason = (() => {
    if (!person) return 'Personel bilgisi bulunamadı.';
    if (!currentUser?.token) return 'Oturum bilgisi bulunamadı.';
    if (!adUser) return 'Kullanıcı adı bulunamadı.';
    if (!password) return 'Yeni şifre girin.';
    if (passwordError) return passwordError;
    if (!confirmPassword) return 'Şifre tekrarını girin.';
    if (password !== confirmPassword) return 'Şifre ve tekrar alanı aynı değil.';
    if (notifySms && !isValidTrMobile(phone)) return 'SMS için 5 ile başlayan 10 haneli telefon girin.';
    if (notifySms && !phoneConfirmed) return 'Telefon numarasının personele ait olduğunu onaylayın.';
    return '';
  })();
  const canSubmit =
    person &&
    currentUser?.token &&
    adUser &&
    password &&
    confirmPassword &&
    password === confirmPassword &&
    !passwordError &&
    smsReady &&
    !isSubmitting;

  const submit = async () => {
    setLocalError('');
    if (!adUser) return setLocalError('Bu personel için AD kullanıcı adı bulunamadı.');
    if (passwordError) return setLocalError(passwordError);
    if (password !== confirmPassword) return setLocalError('Şifre ve tekrar alanı aynı değil.');
    if (notifySms && !isValidTrMobile(phone)) return setLocalError('SMS için geçerli telefon numarası girin.');
    if (notifySms && !phoneConfirmed) return setLocalError('Telefon numarasının personele ait olduğunu onaylayın.');

    setIsSubmitting(true);
    try {
      const encrypted = await encryptAdPassword(password);
      const normalizedPhone = normalizePhone(phone);
      const res = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'enqueueADPasswordReset',
          authToken: currentUser.token,
          personId: person.id,
          passwordMode: mode,
          passwordCiphertext: encrypted.ciphertext,
          encryptionAlg: encrypted.algorithm,
          encryptionKeyId: encrypted.keyId,
          reason: `Personel profili üzerinden ${modeLabel.toLocaleLowerCase('tr-TR')} bilgisayar/Wi-Fi şifre sıfırlama`,
          notifyEmail,
          notifySms,
          notifyPhone: notifySms ? normalizedPhone : '',
          clientIp,
          userAgent: navigator.userAgent,
        }),
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.error || 'İşlem kuyruğa alınamadı.');
      if (notifySms && onPhoneSaved) onPhoneSaved(person.id, normalizedPhone);

      onQueued?.(result);
      onClose?.();
    } catch (error) {
      setLocalError(error.message || 'İşlem kuyruğa alınamadı.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      style={{ zIndex: 2147483647 }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-200">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-blue-50 text-[#0066b1] flex items-center justify-center border border-blue-100 shrink-0">
              <LockKeyhole className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-black text-gray-900 leading-tight">Bilgisayar/Wi‑Fi Şifresi</h3>
              <p className="text-xs text-gray-500 truncate">{person?.name || '-'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full border border-gray-200 text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3 grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">Kullanıcı Adı</p>
              <p className="text-sm font-black text-gray-900 truncate">{adUser || 'Bulunamadı'}</p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">Kampüs</p>
              <p className="text-sm font-black text-gray-900 truncate">{person?.campus || '-'}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('PERMANENT')}
              className={`rounded-xl border px-3 py-3 text-left transition-all ${
                mode === 'PERMANENT'
                  ? 'border-[#0066b1] bg-blue-50 text-[#0066b1] shadow-sm'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              <p className="text-sm font-black">Kalıcı</p>
              <p className="text-[10px] font-semibold mt-0.5">Wi-Fi / mobil erişim</p>
            </button>
            <button
              type="button"
              onClick={() => setMode('TEMPORARY')}
              className={`rounded-xl border px-3 py-3 text-left transition-all ${
                mode === 'TEMPORARY'
                  ? 'border-[#0066b1] bg-blue-50 text-[#0066b1] shadow-sm'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              <p className="text-sm font-black">Geçici</p>
              <p className="text-[10px] font-semibold mt-0.5">İlk girişte değiştir</p>
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-black uppercase tracking-wider text-gray-500">Yeni Şifre</label>
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 h-11 focus-within:border-[#0066b1] focus-within:ring-2 focus-within:ring-[#0066b1]/10">
              <KeyRound className="w-4 h-4 text-gray-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="flex-1 min-w-0 outline-none text-sm font-semibold"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="text-gray-400 hover:text-gray-700"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {password && passwordError && <p className="text-[11px] font-bold text-red-600">{passwordError}</p>}
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-black uppercase tracking-wider text-gray-500">Şifre Tekrar</label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 h-11 outline-none text-sm font-semibold focus:border-[#0066b1] focus:ring-2 focus:ring-[#0066b1]/10"
              autoComplete="new-password"
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2">
            <p className="text-[11px] font-black uppercase tracking-wider text-gray-500">Personele Bildir</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNotifyEmail((v) => !v)}
                className={`h-10 rounded-lg border text-xs font-black flex items-center justify-center gap-1.5 transition-colors ${
                  notifyEmail ? 'bg-[#0066b1] text-white border-[#0066b1]' : 'bg-white text-gray-600 border-gray-200'
                }`}
              >
                <Mail className="w-3.5 h-3.5" /> E-posta
              </button>
              <button
                type="button"
                onClick={() => setNotifySms((v) => !v)}
                className={`h-10 rounded-lg border text-xs font-black flex items-center justify-center gap-1.5 transition-colors ${
                  notifySms ? 'bg-[#0066b1] text-white border-[#0066b1]' : 'bg-white text-gray-600 border-gray-200'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" /> SMS
              </button>
            </div>
            {notifySms && (
              <div className="space-y-2">
                <input
                  value={phone}
                  onChange={(e) => {
                    setPhone(normalizePhone(e.target.value));
                    setPhoneConfirmed(false);
                  }}
                  inputMode="tel"
                  maxLength={10}
                  placeholder="5XXXXXXXXX"
                  className="w-full h-10 px-3 rounded-lg border border-blue-200 bg-white text-center text-sm font-black text-[#0066b1] outline-none focus:border-[#0066b1]"
                />
                <label className="flex items-start gap-2 text-[10px] font-bold text-gray-600 leading-relaxed">
                  <input
                    type="checkbox"
                    checked={phoneConfirmed}
                    onChange={(e) => setPhoneConfirmed(e.target.checked)}
                    className="mt-0.5"
                  />
                  Bu telefon numarasının personele ait olduğunu onaylıyorum.
                </label>
              </div>
            )}
          </div>

          {localError && (
            <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs font-bold p-3">
              {localError}
            </div>
          )}
        </div>

        <div className="p-4 bg-slate-50 border-t border-gray-100 grid grid-cols-[1fr_1.25fr] gap-2 items-end">
          <button
            onClick={onClose}
            className="flex-1 h-11 rounded-xl bg-white border border-gray-200 text-gray-700 font-black text-sm hover:bg-gray-50 transition-colors"
          >
            İptal
          </button>
          <div className="min-w-0">
            {!canSubmit && !isSubmitting && disabledReason && (
              <p className="mb-1 text-[10px] font-bold text-amber-700 text-center leading-tight">
                {disabledReason}
              </p>
            )}
            <button
              onClick={submit}
              disabled={!canSubmit}
              className="w-full h-11 rounded-xl bg-[#0066b1] text-white font-black text-sm hover:bg-[#005595] transition-colors disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-center gap-2 px-4 whitespace-nowrap min-w-0"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {isSubmitting ? 'Şifre İşleniyor' : 'Şifreyi Değiştir'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
