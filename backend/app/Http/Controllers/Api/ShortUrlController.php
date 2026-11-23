<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ShortUrl;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

class ShortUrlController extends Controller
{
    // 1. Endpoint untuk membuat Short URL (mendukung custom_code)
    public function store(Request $request)
    {
        $validated = $request->validate([
            'original_url' => ['required', 'url', 'max:2048'],
            'custom_code' => [
                'nullable',
                'string',
                'regex:/^[A-Za-z0-9_-]+$/',
                'min:3',
                'max:32',
                'unique:short_urls,short_code',
            ],
        ]);

        $shortCode = !empty($validated['custom_code'])
            ? $validated['custom_code']
            : $this->generateUniqueCode();

        $shortUrl = ShortUrl::create([
            'original_url' => $validated['original_url'],
            'short_code' => $shortCode,
            'clicks' => 0,
        ]);

        Cache::put('short_url:' . $shortCode, $validated['original_url'], now()->addHours(24));

        return response()->json([
            'success' => true,
            'message' => 'URL berhasil dibuat dan disimpan!',
            'data' => [
                'original_url' => $shortUrl->original_url,
                'short_code' => $shortUrl->short_code,
                'short_url' => url('/api/' . $shortUrl->short_code),
                'clicks' => $shortUrl->clicks,
            ],
        ], 201);
    }

    // 2. Endpoint untuk menyetel ulang / mengganti short_code yang sudah ada
    public function updateCode(Request $request, string $code)
    {
        $shortUrl = ShortUrl::where('short_code', $code)->first();

        if (!$shortUrl) {
            return response()->json([
                'success' => false,
                'message' => 'Short URL tidak ditemukan.',
            ], 404);
        }

        $validated = $request->validate([
            'new_code' => [
                'required',
                'string',
                'regex:/^[A-Za-z0-9_-]+$/',
                'min:3',
                'max:32',
                'unique:short_urls,short_code,' . $shortUrl->id,
            ],
        ]);

        $oldCode = $shortUrl->short_code;
        $newCode = $validated['new_code'];

        $shortUrl->update([
            'short_code' => $newCode,
        ]);

        // Bersihkan cache kode lama & simpan cache kode baru
        Cache::forget('short_url:' . $oldCode);
        Cache::put('short_url:' . $newCode, $shortUrl->original_url, now()->addHours(24));

        return response()->json([
            'success' => true,
            'message' => 'Short code berhasil diperbarui!',
            'data' => [
                'original_url' => $shortUrl->original_url,
                'short_code' => $shortUrl->short_code,
                'short_url' => url('/api/' . $shortUrl->short_code),
                'clicks' => $shortUrl->clicks,
                'previous_code' => $oldCode,
            ],
        ], 200);
    }

    // 3. Endpoint untuk Redirect sekaligus Menghitung Klik
    public function redirect(string $code)
    {
        $originalUrl = Cache::remember('short_url:' . $code, now()->addHours(24), function () use ($code) {
            $shortUrl = ShortUrl::where('short_code', $code)->first();
            return $shortUrl ? $shortUrl->original_url : null;
        });

        if (!$originalUrl) {
            return response()->json(['message' => 'URL tidak ditemukan.'], 404);
        }

        ShortUrl::where('short_code', $code)->increment('clicks');

        return redirect()->away($originalUrl);
    }

    // 4. Endpoint untuk melihat statistik jumlah klik
    public function stats(string $code)
    {
        $shortUrl = ShortUrl::where('short_code', $code)->first();

        if (!$shortUrl) {
            return response()->json([
                'success' => false,
                'message' => 'URL tidak ditemukan.',
            ], 404);
        }

        return response()->json([
            'success' => true,
            'message' => 'Statistik URL berhasil dimuat.',
            'data' => [
                'original_url' => $shortUrl->original_url,
                'short_code' => $shortUrl->short_code,
                'short_url' => url('/api/' . $shortUrl->short_code),
                'clicks' => $shortUrl->clicks,
                'created_at' => $shortUrl->created_at,
                'updated_at' => $shortUrl->updated_at,
            ],
        ], 200);
    }

    private function generateUniqueCode(): string
    {
        do {
            $code = Str::random(6);
        } while (ShortUrl::where('short_code', $code)->exists());

        return $code;
    }
}