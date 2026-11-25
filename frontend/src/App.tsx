import { useEffect, useRef, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';

const API_BASE_URL = 'http://127.0.0.1:8001/api';
const HISTORY_STORAGE_KEY = 'url_shortener_history_v1';

type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

interface QrCustomization {
  fgColor: string;
  bgColor: string;
  errorCorrectionLevel: QrErrorCorrectionLevel;
  downloadSize: number;
}

interface ShortUrlData {
  original_url: string;
  short_code: string;
  short_url: string;
  clicks: number;
  created_at?: string;
  updated_at?: string;
}

interface ShortenPayload {
  original_url: string;
  custom_code?: string;
}

interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

interface LaravelValidationError {
  message?: string;
  errors?: Record<string, string[]>;
}

const DEFAULT_QR_CUSTOM: QrCustomization = {
  fgColor: '#0f172a',
  bgColor: '#ffffff',
  errorCorrectionLevel: 'M',
  downloadSize: 400,
};

const QR_COLOR_PRESETS: Array<{ label: string; fg: string; bg: string }> = [
  { label: 'Klasik Gelap', fg: '#0f172a', bg: '#ffffff' },
  { label: 'Biru Royal', fg: '#1d4ed8', bg: '#eff6ff' },
  { label: 'Hijau Zamrud', fg: '#047857', bg: '#ecfdf5' },
  { label: 'Ungu Modern', fg: '#6d28d9', bg: '#f5f3ff' },
  { label: 'Mode Gelap', fg: '#f8fafc', bg: '#0f172a' },
];

function slugifyCode(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_-]/g, '');
}

// Mengambil short_code saja jika user menempelkan URL lengkap (misal: http://127.0.0.1:8001/api/halo)
function extractShortCode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const parsed = new URL(trimmed);
      const segments = parsed.pathname.split('/').filter(Boolean);
      return segments[segments.length - 1] ?? '';
    }
  } catch {
    // Jika bukan URL valid, lanjutkan pembersihan manual di bawah
  }

  const withoutQuery = trimmed.split('?')[0].split('#')[0];
  const segments = withoutQuery.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

function loadHistoryFromStorage(): ShortUrlData[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function extractErrorMessage(
  body: (ApiResponse<unknown> & LaravelValidationError) | null,
  fallback: string
): string {
  if (body?.errors) {
    const firstFieldErrors = Object.values(body.errors)[0];
    if (Array.isArray(firstFieldErrors) && firstFieldErrors.length > 0) {
      return firstFieldErrors[0];
    }
  }
  return body?.message || fallback;
}

export function App() {
  const [originalUrl, setOriginalUrl] = useState<string>('');
  const [customCode, setCustomCode] = useState<string>('');
  const [result, setResult] = useState<ShortUrlData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [statusNotice, setStatusNotice] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [sharedCode, setSharedCode] = useState<string | null>(null);

  // State untuk Custom QR Code
  const [activeQrCode, setActiveQrCode] = useState<string | null>(null);
  const [qrCustom, setQrCustom] = useState<QrCustomization>(DEFAULT_QR_CUSTOM);
  const [qrImageMap, setQrImageMap] = useState<Record<string, string>>({});
  const [qrError, setQrError] = useState<string>('');
  const [copiedQrCode, setCopiedQrCode] = useState<string | null>(null);

  // State untuk ganti / setel ulang nama short_code yang sudah ada
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState<string>('');
  const [isRenaming, setIsRenaming] = useState<boolean>(false);

  const [history, setHistory] = useState<ShortUrlData[]>(() => loadHistoryFromStorage());
  const [refreshingCode, setRefreshingCode] = useState<string | null>(null);

  const [statsCode, setStatsCode] = useState<string>('');
  const [statsData, setStatsData] = useState<ShortUrlData | null>(null);
  const [statsError, setStatsError] = useState<string>('');
  const [isCheckingStats, setIsCheckingStats] = useState<boolean>(false);
  const [liveSync, setLiveSync] = useState<boolean>(true);

  const pollTimeoutsRef = useRef<number[]>([]);

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch {
      // Abaikan jika localStorage tidak tersedia
    }
  }, [history]);

  useEffect(() => {
    return () => {
      pollTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
      pollTimeoutsRef.current = [];
    };
  }, []);

  const buildQrCacheKey = (code: string, custom: QrCustomization) =>
    `${code}|${custom.fgColor}|${custom.bgColor}|${custom.errorCorrectionLevel}|${custom.downloadSize}`;

  const generateQrDataUrl = async (
    code: string,
    targetUrl: string,
    custom: QrCustomization = qrCustom,
    widthPx = 260
  ): Promise<string | null> => {
    const cacheKey = `${buildQrCacheKey(code, custom)}|w=${widthPx}`;
    if (qrImageMap[cacheKey]) {
      return qrImageMap[cacheKey];
    }

    try {
      const dataUrl = await QRCode.toDataURL(targetUrl, {
        width: widthPx,
        margin: 2,
        errorCorrectionLevel: custom.errorCorrectionLevel,
        color: {
          dark: custom.fgColor,
          light: custom.bgColor,
        },
      });
      setQrImageMap((prev) => ({ ...prev, [cacheKey]: dataUrl }));
      return dataUrl;
    } catch {
      setQrError('Gagal membuat QR Code. Coba periksa kontras warna atau format URL.');
      return null;
    }
  };

  // Render ulang pratinjau QR saat kustomisasi berubah dan panel QR sedang terbuka
  useEffect(() => {
    if (!activeQrCode) return;

    const targetItem =
      result?.short_code === activeQrCode
        ? result
        : history.find((item) => item.short_code === activeQrCode);

    if (!targetItem) return;

    let cancelled = false;
    void (async () => {
      const dataUrl = await generateQrDataUrl(
        targetItem.short_code,
        targetItem.short_url,
        qrCustom,
        260
      );
      if (!cancelled && dataUrl) {
        setQrError('');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeQrCode, qrCustom, result, history]);

  const handleToggleQr = async (code: string, targetUrl: string) => {
    setQrError('');
    if (activeQrCode === code) {
      setActiveQrCode(null);
      return;
    }

    const dataUrl = await generateQrDataUrl(code, targetUrl, qrCustom, 260);
    if (dataUrl) {
      setActiveQrCode(code);
    }
  };

  const handleDownloadQr = async (code: string, targetUrl: string) => {
    setQrError('');
    const dataUrl = await generateQrDataUrl(
      code,
      targetUrl,
      qrCustom,
      qrCustom.downloadSize
    );
    if (!dataUrl) return;

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `qr-${code}-${qrCustom.downloadSize}px.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopyQrImage = async (code: string, targetUrl: string) => {
    setQrError('');
    if (
      typeof ClipboardItem === 'undefined' ||
      !navigator.clipboard ||
      typeof navigator.clipboard.write !== 'function'
    ) {
      setQrError('Browser ini tidak mendukung salin gambar langsung ke clipboard. Gunakan Unduh PNG.');
      return;
    }

    const dataUrl = await generateQrDataUrl(
      code,
      targetUrl,
      qrCustom,
      qrCustom.downloadSize
    );
    if (!dataUrl) return;

    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopiedQrCode(code);
      setTimeout(() => setCopiedQrCode((prev) => (prev === code ? null : prev)), 2000);
    } catch {
      setQrError('Gagal menyalin gambar QR ke clipboard. Coba gunakan Unduh PNG.');
    }
  };

  const upsertHistoryItem = (item: ShortUrlData, previousCode?: string) => {
    setHistory((prev) => {
      const filtered = prev.filter(
        (entry) =>
          entry.short_code !== item.short_code &&
          (!previousCode || entry.short_code !== previousCode)
      );
      return [item, ...filtered];
    });
  };

  const applyLatestStats = (latest: ShortUrlData) => {
    upsertHistoryItem(latest);

    setResult((prev) =>
      prev && prev.short_code === latest.short_code
        ? { ...prev, clicks: latest.clicks, short_url: latest.short_url }
        : prev
    );

    setStatsData((prev) =>
      prev && prev.short_code === latest.short_code ? latest : prev
    );
  };

  const fetchStatsByCode = async (
    targetCode: string,
    options?: { silent?: boolean; selectAsActiveStats?: boolean }
  ) => {
    const cleanCode = extractShortCode(targetCode);
    if (!cleanCode) {
      if (!options?.silent) {
        setStatsError('Masukkan short code terlebih dahulu.');
      }
      return null;
    }

    if (options?.selectAsActiveStats) {
      setStatsCode(cleanCode);
    }

    if (!options?.silent) {
      setStatsError('');
      setIsCheckingStats(true);
      setRefreshingCode(cleanCode);
    }

    try {
      const response = await fetch(
        `${API_BASE_URL}/stats/${encodeURIComponent(cleanCode)}`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
        }
      );

      const body = await parseJsonSafe<ApiResponse<ShortUrlData> & { message?: string }>(
        response
      );

      if (!response.ok || !body?.data) {
        if (!options?.silent) {
          setStatsData(null);
          setStatsError(
            body?.message || 'Short code tidak ditemukan atau terjadi kesalahan.'
          );
        }
        return null;
      }

      const latest = body.data;
      if (options?.selectAsActiveStats) {
        setStatsCode(latest.short_code);
        setStatsData(latest);
        setStatsError('');
      }
      applyLatestStats(latest);
      return latest;
    } catch {
      if (!options?.silent) {
        setStatsData(null);
        setStatsError('Terjadi kesalahan saat mengambil statistik.');
      }
      return null;
    } finally {
      if (!options?.silent) {
        setIsCheckingStats(false);
        setRefreshingCode(null);
      }
    }
  };

  useEffect(() => {
    const activeCode = extractShortCode(statsData?.short_code || statsCode);
    if (!liveSync || !activeCode) return;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchStatsByCode(activeCode, { silent: true });
      }
    }, 3000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fetchStatsByCode(activeCode, { silent: true });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [liveSync, statsData?.short_code, statsCode]);

  const handleLinkClick = (item: ShortUrlData) => {
    const code = extractShortCode(item.short_code || item.short_url);
    if (!code) return;

    const optimisticClicks = (item.clicks ?? 0) + 1;
    const optimisticItem: ShortUrlData = {
      ...item,
      short_code: code,
      clicks: optimisticClicks,
    };

    applyLatestStats(optimisticItem);
    setStatsCode(code);
    setStatsData((prev) =>
      prev && prev.short_code === code
        ? { ...prev, clicks: optimisticClicks }
        : prev
    );

    const delays = [400, 1200, 2500];
    delays.forEach((delay) => {
      const timeoutId = window.setTimeout(() => {
        void fetchStatsByCode(code, { silent: true });
      }, delay);
      pollTimeoutsRef.current.push(timeoutId);
    });
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage('');
    setStatusNotice('');
    setQrError('');
    setResult(null);
    setCopiedCode(null);
    setIsLoading(true);

    const cleanCustomCode = slugifyCode(customCode);
    const payload: ShortenPayload = {
      original_url: originalUrl.trim(),
    };

    if (cleanCustomCode !== '') {
      payload.custom_code = cleanCustomCode;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/shorten`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const body = await parseJsonSafe<ApiResponse<ShortUrlData> & LaravelValidationError>(
        response
      );

      if (!response.ok || !body?.data) {
        setErrorMessage(
          extractErrorMessage(body, `Gagal membuat short URL dari server (${API_BASE_URL}).`)
        );
        return;
      }

      const created = body.data;
      setResult(created);
      setStatsCode(created.short_code);
      setStatsData(created);
      setStatsError('');
      setOriginalUrl('');
      setCustomCode('');
      setStatusNotice(body.message || 'Short URL berhasil dibuat.');
      upsertHistoryItem(created);
    } catch {
      setErrorMessage(`Gagal terhubung ke server backend (${API_BASE_URL}).`);
    } finally {
      setIsLoading(false);
    }
  };

  const startRename = (code: string) => {
    setErrorMessage('');
    setStatusNotice('');
    setEditingCode(code);
    setRenameInput(code);
  };

  const cancelRename = () => {
    setEditingCode(null);
    setRenameInput('');
  };

  const handleRenameSubmit = async (e: FormEvent<HTMLFormElement>, oldCode: string) => {
    e.preventDefault();
    const cleanNewCode = slugifyCode(renameInput);

    if (!cleanNewCode) {
      setErrorMessage('Masukkan nama short code baru terlebih dahulu.');
      return;
    }

    if (cleanNewCode === oldCode) {
      cancelRename();
      return;
    }

    setErrorMessage('');
    setStatusNotice('');
    setIsRenaming(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/urls/${encodeURIComponent(oldCode)}`,
        {
          method: 'PATCH',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ new_code: cleanNewCode }),
        }
      );

      const body = await parseJsonSafe<
        ApiResponse<ShortUrlData & { previous_code?: string }> & LaravelValidationError
      >(response);

      if (!response.ok || !body?.data) {
        setErrorMessage(extractErrorMessage(body, 'Gagal mengubah nama short code.'));
        return;
      }

      const updated = body.data;
      upsertHistoryItem(updated, oldCode);

      if (result?.short_code === oldCode) {
        setResult(updated);
      }
      if (statsData?.short_code === oldCode || statsCode === oldCode) {
        setStatsCode(updated.short_code);
        setStatsData(updated);
      }
      if (activeQrCode === oldCode) {
        setActiveQrCode(updated.short_code);
        void generateQrDataUrl(updated.short_code, updated.short_url, qrCustom, 260);
      }

      setStatusNotice(
        body.message || `Nama berhasil diubah menjadi ${updated.short_code}.`
      );
      cancelRename();
    } catch {
      setErrorMessage(`Gagal terhubung ke server backend (${API_BASE_URL}).`);
    } finally {
      setIsRenaming(false);
    }
  };

  const handleStatsSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await fetchStatsByCode(statsCode, { selectAsActiveStats: true });
  };

  const handleCopy = async (shortUrl: string, code: string) => {
    try {
      await navigator.clipboard.writeText(shortUrl);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode((prev) => (prev === code ? null : prev)), 2000);
    } catch {
      setErrorMessage('Gagal menyalin URL ke clipboard.');
    }
  };

  const markSharedFeedback = (code: string) => {
    setSharedCode(code);
    window.setTimeout(() => {
      setSharedCode((prev) => (prev === code ? null : prev));
    }, 2000);
  };

  const handleNativeShare = async (item: ShortUrlData) => {
    const shareText = `Cek link ini: ${item.short_url}`;

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `Short Link (${item.short_code})`,
          text: shareText,
          url: item.short_url,
        });
        markSharedFeedback(item.short_code);
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
      }
    }

    await handleCopy(item.short_url, item.short_code);
    setStatusNotice('Link disalin ke clipboard (Web Share tidak didukung di browser ini).');
  };

  const getWhatsAppShareUrl = (item: ShortUrlData) =>
    `https://wa.me/?text=${encodeURIComponent(`Cek link ini: ${item.short_url}`)}`;

  const getTelegramShareUrl = (item: ShortUrlData) =>
    `https://t.me/share/url?url=${encodeURIComponent(item.short_url)}&text=${encodeURIComponent(
      `Link pendek: ${item.short_code}`
    )}`;

  const handleRemoveHistoryItem = (code: string) => {
    setHistory((prev) => prev.filter((item) => item.short_code !== code));
    if (editingCode === code) {
      cancelRename();
    }
    if (activeQrCode === code) {
      setActiveQrCode(null);
    }
  };

  const handleClearHistory = () => {
    setHistory([]);
    cancelRename();
    setActiveQrCode(null);
  };

  const renderQrPanel = (code: string, shortUrl: string) => {
    if (activeQrCode !== code) return null;
    const previewKey = `${buildQrCacheKey(code, qrCustom)}|w=260`;
    const imgSrc = qrImageMap[previewKey];

    return (
      <div style={styles.qrBox}>
        <div style={styles.qrLayout}>
          <div style={styles.qrPreviewCol}>
            {imgSrc ? (
              <img
                src={imgSrc}
                alt={`QR Code untuk ${shortUrl}`}
                style={{
                  ...styles.qrImage,
                  backgroundColor: qrCustom.bgColor,
                }}
              />
            ) : (
              <div style={styles.qrPlaceholder}>Membuat QR...</div>
            )}
            <div style={styles.qrCaption}>
              Target: <strong>{shortUrl}</strong>
            </div>
          </div>

          <div style={styles.qrControlsCol}>
            <div style={styles.qrSectionLabel}>Preset Tema Cepat</div>
            <div style={styles.presetRow}>
              {QR_COLOR_PRESETS.map((preset) => {
                const isSelected =
                  qrCustom.fgColor.toLowerCase() === preset.fg.toLowerCase() &&
                  qrCustom.bgColor.toLowerCase() === preset.bg.toLowerCase();
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() =>
                      setQrCustom((prev) => ({
                        ...prev,
                        fgColor: preset.fg,
                        bgColor: preset.bg,
                      }))
                    }
                    style={{
                      ...styles.presetChip,
                      borderColor: isSelected ? '#2563eb' : '#cbd5e1',
                      backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
                    }}
                  >
                    <span
                      style={{
                        ...styles.swatchDot,
                        backgroundColor: preset.fg,
                        borderColor: preset.bg,
                      }}
                    />
                    <span>{preset.label}</span>
                  </button>
                );
              })}
            </div>

            <div style={styles.qrColorGrid}>
              <label style={styles.qrFieldLabel}>
                <span>Warna QR</span>
                <div style={styles.colorInputWrap}>
                  <input
                    type="color"
                    value={qrCustom.fgColor}
                    onChange={(e) =>
                      setQrCustom((prev) => ({ ...prev, fgColor: e.target.value }))
                    }
                    style={styles.colorPicker}
                  />
                  <span style={styles.colorHex}>{qrCustom.fgColor.toUpperCase()}</span>
                </div>
              </label>

              <label style={styles.qrFieldLabel}>
                <span>Warna Latar</span>
                <div style={styles.colorInputWrap}>
                  <input
                    type="color"
                    value={qrCustom.bgColor}
                    onChange={(e) =>
                      setQrCustom((prev) => ({ ...prev, bgColor: e.target.value }))
                    }
                    style={styles.colorPicker}
                  />
                  <span style={styles.colorHex}>{qrCustom.bgColor.toUpperCase()}</span>
                </div>
              </label>
            </div>

            <div style={styles.qrColorGrid}>
              <label style={styles.qrFieldLabel}>
                <span>Resolusi Unduh</span>
                <select
                  value={qrCustom.downloadSize}
                  onChange={(e) =>
                    setQrCustom((prev) => ({
                      ...prev,
                      downloadSize: Number(e.target.value),
                    }))
                  }
                  style={styles.qrSelect}
                >
                  <option value={240}>240 x 240 px</option>
                  <option value={400}>400 x 400 px</option>
                  <option value={600}>600 x 600 px</option>
                </select>
              </label>

              <label style={styles.qrFieldLabel}>
                <span>Error Correction</span>
                <select
                  value={qrCustom.errorCorrectionLevel}
                  onChange={(e) =>
                    setQrCustom((prev) => ({
                      ...prev,
                      errorCorrectionLevel: e.target.value as QrErrorCorrectionLevel,
                    }))
                  }
                  style={styles.qrSelect}
                >
                  <option value="L">L — Rendah (7%)</option>
                  <option value="M">M — Sedang (15%)</option>
                  <option value="Q">Q — Tinggi (25%)</option>
                  <option value="H">H — Maksimal (30%)</option>
                </select>
              </label>
            </div>

            <div style={styles.actionGroup}>
              <button
                type="button"
                onClick={() => void handleDownloadQr(code, shortUrl)}
                style={styles.miniPrimaryButton}
              >
                Unduh PNG ({qrCustom.downloadSize}px)
              </button>
              <button
                type="button"
                onClick={() => void handleCopyQrImage(code, shortUrl)}
                style={styles.miniButton}
              >
                {copiedQrCode === code ? 'Gambar Tersalin' : 'Salin Gambar'}
              </button>
              <button
                type="button"
                onClick={() => setQrCustom(DEFAULT_QR_CUSTOM)}
                style={styles.miniButton}
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setActiveQrCode(null)}
                style={styles.miniButton}
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderRenameForm = (currentCode: string) => (
    <form
      onSubmit={(e) => void handleRenameSubmit(e, currentCode)}
      style={styles.renameForm}
    >
      <input
        type="text"
        value={renameInput}
        onChange={(e) => setRenameInput(e.target.value)}
        placeholder="nama-baru-link"
        style={styles.renameInput}
        autoFocus
      />
      <button
        type="submit"
        disabled={isRenaming}
        style={styles.miniPrimaryButton}
      >
        {isRenaming ? 'Menyimpan...' : 'Simpan Nama'}
      </button>
      <button
        type="button"
        onClick={cancelRename}
        disabled={isRenaming}
        style={styles.miniButton}
      >
        Batal
      </button>
    </form>
  );

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div style={styles.badgeRow}>
            <span style={styles.badge}>Laravel API</span>
            <span style={styles.badge}>MySQL</span>
            <span style={styles.badge}>Custom QR Code</span>
            <span style={styles.badge}>Bagikan Link</span>
          </div>
          <h1 style={styles.title}>URL Shortener Dashboard</h1>
          <p style={styles.subtitle}>
            Pendekkan URL, atur nama custom agar rapi, kustomisasi QR Code, bagikan link, dan pantau klik secara langsung.
          </p>
        </header>

        <section style={styles.card} aria-label="Form Buat Short URL">
          <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.fieldGroup}>
              <label htmlFor="original-url" style={styles.label}>
                URL Asli
              </label>
              <input
                id="original-url"
                type="url"
                required
                placeholder="https://example.com/artikel-atau-halaman-panjang"
                value={originalUrl}
                onChange={(e) => setOriginalUrl(e.target.value)}
                style={styles.input}
              />
            </div>

            <div style={styles.fieldGroup}>
              <label htmlFor="custom-code" style={styles.label}>
                Custom Nama Link <span style={styles.optional}>(Opsional — huruf, angka, -, _)</span>
              </label>
              <input
                id="custom-code"
                type="text"
                placeholder="contoh: promo-spesial"
                value={customCode}
                onChange={(e) => setCustomCode(e.target.value)}
                style={styles.input}
              />
              {customCode.trim() !== '' && (
                <span style={styles.helperText}>
                  Pratinjau nama rapi: <strong>{slugifyCode(customCode) || '-'}</strong>
                </span>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              style={{
                ...styles.primaryButton,
                opacity: isLoading ? 0.65 : 1,
                cursor: isLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {isLoading ? 'Membuat Short URL...' : 'Buat Short URL'}
            </button>
          </form>

          {statusNotice && (
            <div role="status" style={styles.noticeBox}>
              {statusNotice}
            </div>
          )}

          {qrError && (
            <div role="alert" style={styles.errorBox}>
              {qrError}
            </div>
          )}

          {errorMessage && (
            <div role="alert" style={styles.errorBox}>
              {errorMessage}
            </div>
          )}

          {result && (
            <div style={styles.resultBox}>
              <div style={styles.resultHeader}>
                <span style={styles.resultTag}>Berhasil Dibuat</span>
                <span style={styles.clickPill}>{result.clicks} Klik</span>
              </div>

              <div style={styles.shortUrlRow}>
                <a
                  href={result.short_url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => handleLinkClick(result)}
                  style={styles.shortUrlLink}
                >
                  {result.short_url}
                </a>

                <div style={styles.actionGroup}>
                  <button
                    type="button"
                    onClick={() => handleCopy(result.short_url, result.short_code)}
                    style={styles.secondaryButton}
                  >
                    {copiedCode === result.short_code ? 'Tersalin' : 'Salin'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleNativeShare(result)}
                    style={styles.secondaryButton}
                  >
                    {sharedCode === result.short_code ? 'Dibagikan' : 'Bagikan'}
                  </button>
                  <a
                    href={getWhatsAppShareUrl(result)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ ...styles.secondaryButton, textDecoration: 'none' }}
                  >
                    WhatsApp
                  </a>
                  <a
                    href={getTelegramShareUrl(result)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ ...styles.secondaryButton, textDecoration: 'none' }}
                  >
                    Telegram
                  </a>
                  <button
                    type="button"
                    onClick={() => void handleToggleQr(result.short_code, result.short_url)}
                    style={styles.secondaryButton}
                  >
                    {activeQrCode === result.short_code ? 'Tutup Custom QR' : 'Custom QR'}
                  </button>
                  <button
                    type="button"
                    onClick={() => startRename(result.short_code)}
                    style={styles.secondaryButton}
                  >
                    Ganti Nama
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void fetchStatsByCode(result.short_code, { selectAsActiveStats: true })
                    }
                    disabled={refreshingCode === result.short_code}
                    style={styles.secondaryButton}
                  >
                    {refreshingCode === result.short_code ? 'Memuat...' : 'Refresh Klik'}
                  </button>
                </div>
              </div>

              {renderQrPanel(result.short_code, result.short_url)}
              {editingCode === result.short_code && renderRenameForm(result.short_code)}

              <div style={styles.metaText}>
                <div><strong>Nama / Kode:</strong> {result.short_code}</div>
                <div style={{ wordBreak: 'break-all' }}><strong>Tujuan:</strong> {result.original_url}</div>
              </div>
            </div>
          )}
        </section>

        <div style={styles.grid}>
          <section style={styles.card} aria-label="Cek Statistik Klik">
            <div style={styles.statsHeaderRow}>
              <div>
                <h2 style={styles.sectionTitle}>Statistik Klik Realtime</h2>
                <p style={styles.sectionDesc}>
                  Angka naik otomatis saat link diklik & disinkronkan tiap 3 detik.
                </p>
              </div>
              <label style={styles.toggleLabel}>
                <input
                  type="checkbox"
                  checked={liveSync}
                  onChange={(e) => setLiveSync(e.target.checked)}
                />
                <span>Auto-sync</span>
              </label>
            </div>

            <form onSubmit={handleStatsSubmit} style={styles.statsForm}>
              <input
                type="text"
                placeholder="Masukkan kode atau link pendek..."
                value={statsCode}
                onChange={(e) => setStatsCode(e.target.value)}
                style={{ ...styles.input, flex: 1 }}
              />
              <button
                type="submit"
                disabled={isCheckingStats}
                style={{
                  ...styles.darkButton,
                  opacity: isCheckingStats ? 0.65 : 1,
                  cursor: isCheckingStats ? 'not-allowed' : 'pointer',
                }}
              >
                {isCheckingStats ? 'Mencari...' : 'Cek'}
              </button>
            </form>

            {statsError && (
              <div role="alert" style={styles.errorBox}>
                {statsError}
              </div>
            )}

            {statsData && (
              <div style={styles.statsResult}>
                <div style={styles.statNumber}>{statsData.clicks}</div>
                <div style={styles.statLabel}>Total Klik ({statsData.short_code})</div>
                <div style={styles.metaText}>
                  <div style={{ wordBreak: 'break-all' }}><strong>URL Asli:</strong> {statsData.original_url}</div>
                </div>
              </div>
            )}
          </section>

          <section style={styles.card} aria-label="Riwayat Short URL">
            <div style={styles.historyTop}>
              <div>
                <h2 style={styles.sectionTitle}>Riwayat ({history.length})</h2>
                <p style={styles.sectionDesc}>Klik link untuk menguji klik, bagikan, atau kustomisasi QR.</p>
              </div>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearHistory}
                  style={styles.dangerOutlineButton}
                >
                  Hapus Semua
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div style={styles.emptyState}>
                Belum ada riwayat URL. Buat short URL pertama Anda di atas.
              </div>
            ) : (
              <div style={styles.historyList}>
                {history.map((item) => (
                  <div key={item.short_code} style={styles.historyCard}>
                    <div style={styles.historyCardTop}>
                      <a
                        href={item.short_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => handleLinkClick(item)}
                        style={styles.historyLink}
                      >
                        {item.short_url}
                      </a>
                      <span style={styles.clickPill}>{item.clicks} klik</span>
                    </div>

                    <div style={styles.historyUrl}>{item.original_url}</div>

                    {renderQrPanel(item.short_code, item.short_url)}
                    {editingCode === item.short_code && renderRenameForm(item.short_code)}

                    <div style={styles.actionGroup}>
                      <button
                        type="button"
                        onClick={() => handleCopy(item.short_url, item.short_code)}
                        style={styles.miniButton}
                      >
                        {copiedCode === item.short_code ? 'Tersalin' : 'Salin'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleNativeShare(item)}
                        style={styles.miniButton}
                      >
                        {sharedCode === item.short_code ? 'Dibagikan' : 'Bagikan'}
                      </button>
                      <a
                        href={getWhatsAppShareUrl(item)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ ...styles.miniButton, textDecoration: 'none' }}
                      >
                        WhatsApp
                      </a>
                      <a
                        href={getTelegramShareUrl(item)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ ...styles.miniButton, textDecoration: 'none' }}
                      >
                        Telegram
                      </a>
                      <button
                        type="button"
                        onClick={() => void handleToggleQr(item.short_code, item.short_url)}
                        style={styles.miniButton}
                      >
                        {activeQrCode === item.short_code ? 'Tutup QR' : 'Custom QR'}
                      </button>
                      <button
                        type="button"
                        onClick={() => startRename(item.short_code)}
                        style={styles.miniButton}
                      >
                        Ganti Nama
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setStatsCode(item.short_code);
                          void fetchStatsByCode(item.short_code, { selectAsActiveStats: true });
                        }}
                        disabled={refreshingCode === item.short_code}
                        style={styles.miniButton}
                      >
                        {refreshingCode === item.short_code ? '...' : 'Update Klik'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveHistoryItem(item.short_code)}
                        style={styles.miniDangerButton}
                      >
                        Buang
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#f1f5f9',
    color: '#0f172a',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: '32px 16px',
    boxSizing: 'border-box',
  },
  container: {
    maxWidth: '960px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  header: {
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    padding: '24px 28px',
    borderRadius: '14px',
  },
  badgeRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    marginBottom: '12px',
  },
  badge: {
    fontSize: '0.75rem',
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: '999px',
    backgroundColor: '#1e293b',
    color: '#93c5fd',
    border: '1px solid #334155',
  },
  title: {
    margin: '0 0 8px',
    fontSize: '1.75rem',
    fontWeight: 700,
  },
  subtitle: {
    margin: 0,
    color: '#cbd5e1',
    fontSize: '0.95rem',
    lineHeight: 1.5,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: '14px',
    padding: '22px',
    border: '1px solid #e2e8f0',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '0.9rem',
    fontWeight: 600,
    color: '#1e293b',
  },
  optional: {
    fontWeight: 400,
    color: '#64748b',
    fontSize: '0.82rem',
  },
  helperText: {
    fontSize: '0.8rem',
    color: '#475569',
  },
  input: {
    padding: '11px 14px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    fontSize: '0.95rem',
    outline: 'none',
    backgroundColor: '#fff',
    color: '#0f172a',
  },
  primaryButton: {
    padding: '12px 18px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2563eb',
    color: '#ffffff',
    fontWeight: 600,
    fontSize: '0.95rem',
  },
  darkButton: {
    padding: '11px 18px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#0f172a',
    color: '#ffffff',
    fontWeight: 600,
    fontSize: '0.9rem',
  },
  secondaryButton: {
    padding: '6px 12px',
    borderRadius: '7px',
    border: '1px solid #cbd5e1',
    backgroundColor: '#ffffff',
    color: '#0f172a',
    fontWeight: 500,
    fontSize: '0.85rem',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
  },
  dangerOutlineButton: {
    padding: '6px 12px',
    borderRadius: '7px',
    border: '1px solid #fecaca',
    backgroundColor: '#fef2f2',
    color: '#b91c1c',
    fontWeight: 500,
    fontSize: '0.82rem',
    cursor: 'pointer',
  },
  noticeBox: {
    marginTop: '14px',
    padding: '11px 14px',
    borderRadius: '8px',
    backgroundColor: '#f0fdf4',
    border: '1px solid #bbf7d0',
    color: '#15803d',
    fontSize: '0.88rem',
    fontWeight: 500,
  },
  errorBox: {
    marginTop: '14px',
    padding: '12px 14px',
    borderRadius: '8px',
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#b91c1c',
    fontSize: '0.9rem',
  },
  resultBox: {
    marginTop: '18px',
    padding: '16px',
    borderRadius: '10px',
    backgroundColor: '#f8fafc',
    border: '1px solid #cbd5e1',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  resultHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  resultTag: {
    fontSize: '0.78rem',
    fontWeight: 700,
    color: '#15803d',
    backgroundColor: '#dcfce7',
    padding: '3px 10px',
    borderRadius: '999px',
  },
  clickPill: {
    fontSize: '0.78rem',
    fontWeight: 700,
    color: '#1e40af',
    backgroundColor: '#dbeafe',
    padding: '3px 10px',
    borderRadius: '999px',
  },
  shortUrlRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  shortUrlLink: {
    fontSize: '1.05rem',
    fontWeight: 700,
    color: '#2563eb',
    wordBreak: 'break-all',
  },
  actionGroup: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  qrBox: {
    padding: '14px',
    borderRadius: '10px',
    backgroundColor: '#ffffff',
    border: '1px solid #cbd5e1',
  },
  qrLayout: {
    display: 'flex',
    gap: '18px',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  qrPreviewCol: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    flex: '0 0 210px',
  },
  qrImage: {
    width: '190px',
    height: '190px',
    borderRadius: '8px',
    border: '1px solid #e2e8f0',
  },
  qrPlaceholder: {
    width: '190px',
    height: '190px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '8px',
    border: '1px dashed #cbd5e1',
    color: '#64748b',
    fontSize: '0.82rem',
  },
  qrCaption: {
    fontSize: '0.78rem',
    color: '#475569',
    textAlign: 'center',
    wordBreak: 'break-all',
  },
  qrControlsCol: {
    flex: '1 1 260px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  qrSectionLabel: {
    fontSize: '0.8rem',
    fontWeight: 700,
    color: '#334155',
  },
  presetRow: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  presetChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 9px',
    borderRadius: '999px',
    border: '1px solid #cbd5e1',
    fontSize: '0.76rem',
    fontWeight: 600,
    color: '#0f172a',
    cursor: 'pointer',
  },
  swatchDot: {
    width: '11px',
    height: '11px',
    borderRadius: '50%',
    border: '1px solid #94a3b8',
    display: 'inline-block',
  },
  qrColorGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
    gap: '10px',
  },
  qrFieldLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    fontSize: '0.78rem',
    fontWeight: 600,
    color: '#334155',
  },
  colorInputWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '5px 8px',
    borderRadius: '7px',
    border: '1px solid #cbd5e1',
    backgroundColor: '#f8fafc',
  },
  colorPicker: {
    width: '26px',
    height: '22px',
    padding: 0,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
  },
  colorHex: {
    fontSize: '0.78rem',
    fontFamily: 'monospace',
    color: '#0f172a',
  },
  qrSelect: {
    padding: '7px 9px',
    borderRadius: '7px',
    border: '1px solid #cbd5e1',
    backgroundColor: '#ffffff',
    color: '#0f172a',
    fontSize: '0.82rem',
  },
  renameForm: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    alignItems: 'center',
    padding: '10px',
    borderRadius: '8px',
    backgroundColor: '#eef2ff',
    border: '1px solid #c7d2fe',
  },
  renameInput: {
    flex: '1 1 180px',
    padding: '7px 10px',
    borderRadius: '6px',
    border: '1px solid #94a3b8',
    fontSize: '0.86rem',
    backgroundColor: '#ffffff',
    color: '#0f172a',
  },
  metaText: {
    fontSize: '0.85rem',
    color: '#475569',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '20px',
    alignItems: 'start',
  },
  statsHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '10px',
  },
  toggleLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.8rem',
    fontWeight: 600,
    color: '#334155',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  sectionTitle: {
    margin: '0 0 4px',
    fontSize: '1.15rem',
    fontWeight: 700,
  },
  sectionDesc: {
    margin: 0,
    fontSize: '0.85rem',
    color: '#64748b',
  },
  statsForm: {
    display: 'flex',
    gap: '8px',
    marginTop: '14px',
  },
  statsResult: {
    marginTop: '16px',
    padding: '16px',
    borderRadius: '10px',
    backgroundColor: '#f8fafc',
    border: '1px solid #e2e8f0',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  statNumber: {
    fontSize: '2rem',
    fontWeight: 800,
    color: '#2563eb',
    lineHeight: 1.1,
  },
  statLabel: {
    fontSize: '0.85rem',
    fontWeight: 600,
    color: '#334155',
  },
  historyTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '10px',
    marginBottom: '14px',
  },
  emptyState: {
    padding: '24px 16px',
    textAlign: 'center',
    color: '#64748b',
    fontSize: '0.9rem',
    backgroundColor: '#f8fafc',
    borderRadius: '10px',
    border: '1px dashed #cbd5e1',
  },
  historyList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    maxHeight: '420px',
    overflowY: 'auto',
  },
  historyCard: {
    padding: '12px 14px',
    borderRadius: '10px',
    border: '1px solid #e2e8f0',
    backgroundColor: '#f8fafc',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  historyCardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
  },
  historyLink: {
    fontWeight: 700,
    fontSize: '0.9rem',
    color: '#0f172a',
    wordBreak: 'break-all',
  },
  historyUrl: {
    fontSize: '0.8rem',
    color: '#64748b',
    wordBreak: 'break-all',
  },
  miniPrimaryButton: {
    padding: '5px 10px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#2563eb',
    color: '#ffffff',
    fontSize: '0.78rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  miniButton: {
    padding: '4px 9px',
    borderRadius: '6px',
    border: '1px solid #cbd5e1',
    backgroundColor: '#ffffff',
    color: '#0f172a',
    fontSize: '0.78rem',
    fontWeight: 500,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
  },
  miniDangerButton: {
    padding: '4px 9px',
    borderRadius: '6px',
    border: '1px solid #fecaca',
    backgroundColor: '#ffffff',
    color: '#b91c1c',
    fontSize: '0.78rem',
    fontWeight: 500,
    cursor: 'pointer',
  },
};

export default App;