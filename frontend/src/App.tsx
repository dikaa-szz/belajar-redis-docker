import { useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000/api';
const HISTORY_STORAGE_KEY = 'url_shortener_history_v1';

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

export function App() {
  const [originalUrl, setOriginalUrl] = useState<string>('');
  const [customCode, setCustomCode] = useState<string>('');
  const [result, setResult] = useState<ShortUrlData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const [history, setHistory] = useState<ShortUrlData[]>(() => loadHistoryFromStorage());
  const [refreshingCode, setRefreshingCode] = useState<string | null>(null);

  const [statsCode, setStatsCode] = useState<string>('');
  const [statsData, setStatsData] = useState<ShortUrlData | null>(null);
  const [statsError, setStatsError] = useState<string>('');
  const [isCheckingStats, setIsCheckingStats] = useState<boolean>(false);

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch {
      // Abaikan jika localStorage tidak tersedia
    }
  }, [history]);

  const upsertHistoryItem = (item: ShortUrlData) => {
    setHistory((prev) => {
      const filtered = prev.filter((entry) => entry.short_code !== item.short_code);
      return [item, ...filtered];
    });
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage('');
    setResult(null);
    setCopiedCode(null);
    setIsLoading(true);

    const payload: ShortenPayload = {
      original_url: originalUrl.trim(),
    };

    if (customCode.trim() !== '') {
      payload.custom_code = customCode.trim();
    }

    try {
      const response = await axios.post<ApiResponse<ShortUrlData>>(
        `${API_BASE_URL}/shorten`,
        payload,
        {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
        }
      );

      const created = response.data.data;
      setResult(created);
      setStatsCode(created.short_code);
      setStatsData(created);
      setStatsError('');
      setOriginalUrl('');
      setCustomCode('');
      upsertHistoryItem(created);
    } catch (error) {
      if (axios.isAxiosError<LaravelValidationError>(error)) {
        const validationErrors = error.response?.data?.errors;
        if (validationErrors) {
          const firstFieldErrors = Object.values(validationErrors)[0];
          setErrorMessage(
            Array.isArray(firstFieldErrors) && firstFieldErrors.length > 0
              ? firstFieldErrors[0]
              : error.response?.data?.message || 'Data tidak valid.'
          );
        } else {
          setErrorMessage(
            error.response?.data?.message ||
              'Gagal terhubung ke server backend (http://localhost:8000).'
          );
        }
      } else {
        setErrorMessage('Terjadi kesalahan tak terduga.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStatsByCode = async (targetCode: string) => {
    const cleanCode = targetCode.trim();
    if (!cleanCode) {
      setStatsError('Masukkan short code terlebih dahulu.');
      return;
    }

    setStatsError('');
    setIsCheckingStats(true);
    setRefreshingCode(cleanCode);

    try {
      const response = await axios.get<ApiResponse<ShortUrlData>>(
        `${API_BASE_URL}/stats/${encodeURIComponent(cleanCode)}`,
        {
          headers: {
            Accept: 'application/json',
          },
        }
      );

      const latest = response.data.data;
      setStatsData(latest);
      upsertHistoryItem(latest);

      setResult((prev) =>
        prev && prev.short_code === latest.short_code
          ? { ...prev, clicks: latest.clicks }
          : prev
      );
    } catch (error) {
      setStatsData(null);
      if (axios.isAxiosError<{ message?: string }>(error)) {
        setStatsError(
          error.response?.data?.message || 'Short code tidak ditemukan atau terjadi kesalahan.'
        );
      } else {
        setStatsError('Terjadi kesalahan saat mengambil statistik.');
      }
    } finally {
      setIsCheckingStats(false);
      setRefreshingCode(null);
    }
  };

  const handleStatsSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await fetchStatsByCode(statsCode);
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

  const handleRemoveHistoryItem = (code: string) => {
    setHistory((prev) => prev.filter((item) => item.short_code !== code));
  };

  const handleClearHistory = () => {
    setHistory([]);
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div style={styles.badgeRow}>
            <span style={styles.badge}>Laravel API</span>
            <span style={styles.badge}>MySQL</span>
            <span style={styles.badge}>Redis Cache</span>
          </div>
          <h1 style={styles.title}>URL Shortener Dashboard</h1>
          <p style={styles.subtitle}>
            Pendekkan URL, pakai custom alias, akses redirect cepat, dan pantau jumlah klik secara langsung.
          </p>
        </header>

        {/* Card Utama Form Shortener */}
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
                Custom Short Code <span style={styles.optional}>(Opsional)</span>
              </label>
              <input
                id="custom-code"
                type="text"
                placeholder="contoh: promo-spesial"
                value={customCode}
                onChange={(e) => setCustomCode(e.target.value)}
                style={styles.input}
              />
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
                    onClick={() => void fetchStatsByCode(result.short_code)}
                    disabled={refreshingCode === result.short_code}
                    style={styles.secondaryButton}
                  >
                    {refreshingCode === result.short_code ? 'Memuat...' : 'Refresh Klik'}
                  </button>
                </div>
              </div>

              <div style={styles.metaText}>
                <div><strong>Kode:</strong> {result.short_code}</div>
                <div style={{ wordBreak: 'break-all' }}><strong>Tujuan:</strong> {result.original_url}</div>
              </div>
            </div>
          )}
        </section>

        {/* Grid 2 Kolom: Cek Statistik & Riwayat */}
        <div style={styles.grid}>
          <section style={styles.card} aria-label="Cek Statistik Klik">
            <h2 style={styles.sectionTitle}>Cek Statistik Klik</h2>
            <p style={styles.sectionDesc}>
              Cek jumlah klik terbaru berdasarkan <code>short_code</code>.
            </p>

            <form onSubmit={handleStatsSubmit} style={styles.statsForm}>
              <input
                type="text"
                placeholder="Masukkan short code..."
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
                <p style={styles.sectionDesc}>Tersimpan lokal di browser ini.</p>
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
                        style={styles.historyLink}
                      >
                        {item.short_url}
                      </a>
                      <span style={styles.clickPill}>{item.clicks} klik</span>
                    </div>

                    <div style={styles.historyUrl}>{item.original_url}</div>

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
                        onClick={() => {
                          setStatsCode(item.short_code);
                          void fetchStatsByCode(item.short_code);
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
  miniButton: {
    padding: '4px 9px',
    borderRadius: '6px',
    border: '1px solid #cbd5e1',
    backgroundColor: '#ffffff',
    color: '#0f172a',
    fontSize: '0.78rem',
    fontWeight: 500,
    cursor: 'pointer',
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