import { useEffect, useMemo, useState } from 'react';
import { Loader2, Mail, MessageSquare, X } from 'lucide-react';
import { GAS_URL } from '../config/appConfig.js';
import { postApiAction } from '../services/apiClient.js';
import { showAppAlert } from '../services/uiMessageService.js';

const OTP_TTL_SECONDS = 180;

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

export const OtpVerification = ({
  apiUrl = GAS_URL,
  personId,
  personEmail,
  personPhone,
  otpAction,
  hardwareIds,
  onPhoneSaved,
  onVerified,
  currentUser,
}) => {
  const [step, setStep] = useState(1);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(OTP_TTL_SECONDS);
  const [channel, setChannel] = useState('email');
  const [phone, setPhone] = useState(personPhone || '');
  const [phoneConfirmed, setPhoneConfirmed] = useState(false);
  const [challengeId, setChallengeId] = useState('');
  const hardwareContextKey = useMemo(
    () => [...new Set((hardwareIds || []).map((value) => String(value || '').trim()).filter(Boolean))].sort().join('|'),
    [hardwareIds]
  );

  useEffect(() => {
    setPhone(personPhone || '');
  }, [personPhone]);

  useEffect(() => {
    setStep(1);
    setCode('');
    setChallengeId('');
    setTimeLeft(OTP_TTL_SECONDS);
  }, [personId, otpAction, hardwareContextKey]);

  useEffect(() => {
    if (step !== 2 || timeLeft <= 0) return undefined;
    const timerId = setInterval(() => {
      setTimeLeft((prevTime) => prevTime - 1);
    }, 1000);
    return () => clearInterval(timerId);
  }, [step, timeLeft]);

  const destinationText = useMemo(() => {
    if (channel === 'sms') return normalizePhone(phone) || 'telefon numarası';
    return personEmail || 'e-posta adresi';
  }, [channel, phone, personEmail]);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const sendCode = async (e) => {
    if (e) e.preventDefault();
    if (!personEmail) return showAppAlert('Hata: Personelin e-posta adresi sistemde yok.');
    if (channel === 'sms' && !isValidTrMobile(phone)) {
      return showAppAlert('SMS için 5 ile başlayan 10 haneli geçerli telefon numarası girin.');
    }
    if (channel === 'sms' && !phoneConfirmed) {
      return showAppAlert('Lütfen telefon numarasının personele ait olduğunu onaylayın.');
    }

    setLoading(true);
    try {
      const data = await postApiAction(
        {
          action: 'sendOTP',
          personId,
          personPhone: normalizePhone(phone),
          otpChannel: channel,
          otpAction,
          hardwareIds,
          authToken: currentUser.token,
        },
        { url: apiUrl, timeoutMs: 30000 }
      );
      if (!data.challengeId) throw new Error('Sunucu doğrulama isteği oluşturmadı.');
      setChallengeId(data.challengeId);
      if (data.phone && onPhoneSaved) onPhoneSaved(personId, data.phone);
      setStep(2);
      setTimeLeft(OTP_TTL_SECONDS);
      setCode('');
    } catch (error) {
      showAppAlert('Kod gönderilemedi: ' + error.message);
    } finally {
      setLoading(false);
    }
    return undefined;
  };

  const verifyCode = async (e) => {
    e.preventDefault();
    if (code.length !== 6 || timeLeft <= 0) return;
    setLoading(true);
    try {
      const data = await postApiAction(
        {
          action: 'verifyOTP',
          personId,
          challengeId,
          otpCode: code,
          otpAction,
          hardwareIds,
          authToken: currentUser.token,
        },
        { url: apiUrl, timeoutMs: 30000 }
      );
      onVerified({
        email: personEmail,
        time: new Date().toLocaleString('tr-TR'),
        hash: data.hash,
        channel: data.channel || channel,
      });
    } catch (error) {
      showAppAlert('Doğrulama başarısız: ' + error.message);
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center w-full max-w-[340px] mx-auto bg-blue-50/50 p-4 rounded-xl border border-blue-100 shadow-sm mt-4 mb-4 animate-in slide-in-from-top-2">
      <span className="text-[11px] font-extrabold text-[#0066b1] text-center uppercase tracking-wide mb-3">
        Güvenlik Kodu
      </span>

      {step === 1 ? (
        <div className="w-full space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setChannel('email')}
              className={`h-10 rounded-lg border text-xs font-black flex items-center justify-center gap-1.5 transition-colors ${
                channel === 'email' ? 'bg-[#0066b1] text-white border-[#0066b1]' : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              <Mail className="w-3.5 h-3.5" /> E-posta
            </button>
            <button
              type="button"
              onClick={() => setChannel('sms')}
              className={`h-10 rounded-lg border text-xs font-black flex items-center justify-center gap-1.5 transition-colors ${
                channel === 'sms' ? 'bg-[#0066b1] text-white border-[#0066b1]' : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" /> SMS
            </button>
          </div>

          {channel === 'email' ? (
            <p className="text-[11px] text-gray-600 text-center leading-relaxed">
              Kod <strong>{personEmail || '-'}</strong> adresine gönderilecek.
            </p>
          ) : (
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

          <button onClick={sendCode} disabled={loading} className="w-full py-2.5 bg-[#0066b1] text-white text-xs font-bold rounded-lg shadow-md hover:bg-[#005595] transition-colors flex justify-center items-center h-10">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Personele Kod Gönder'}
          </button>
        </div>
      ) : (
        <div className="w-full flex flex-col items-center animate-in fade-in">
          <p className="text-[10px] text-gray-600 mb-2 text-center leading-relaxed">
            <strong>{destinationText}</strong> için gelen 6 haneli kodu giriniz:
          </p>

          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            disabled={timeLeft <= 0 || loading}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="000000"
            style={{ WebkitUserSelect: 'auto', userSelect: 'auto' }}
            className="w-full text-center text-2xl font-black tracking-[0.4em] p-2 border-2 border-blue-300 rounded-lg outline-none focus:border-[#0066b1] mb-3 bg-white text-[#0066b1] h-12 disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200 transition-all"
          />

          {timeLeft > 0 ? (
            <>
              <p className="text-xs font-bold text-amber-600 mb-3 flex items-center gap-1.5">
                Kalan süre: <span className="font-black">{formatTime(timeLeft)}</span>
              </p>
              <button onClick={verifyCode} disabled={loading || code.length !== 6} className="w-full py-2.5 bg-green-600 text-white text-xs font-bold rounded-lg shadow-md hover:bg-green-700 transition-colors flex justify-center items-center h-10 disabled:opacity-50">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Kodu Onayla ve Beyana Geç'}
              </button>
            </>
          ) : (
            <>
              <p className="text-xs font-bold text-red-500 mb-3 flex items-center gap-1.5">
                <X className="w-3.5 h-3.5" /> Kodun süresi doldu!
              </p>
              <button onClick={sendCode} disabled={loading} className="w-full py-2.5 bg-slate-800 text-white text-xs font-bold rounded-lg shadow-md hover:bg-slate-900 transition-colors flex justify-center items-center h-10">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Tekrar Kod İste'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
