<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ShortUrl;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

class ShortUrlController extends Controller
{
    // 1. Buat Short URL (mendukung custom_code agar nama link rapi & sesuai keinginan user)
    public function store(Request $request)
    {
        $validated = $request->validate([
            'original_url' => ['required', 'url', 'max:2048'],
            'custom_code' => [
                'nullable',
                'string',
                'min:3',
                'max:40',
                'regex:/^[A-Za-z0-9_-]+$/',
                'unique:short_urls,short_code',
            ],
        ], [
            'custom_code.regex' => 'Custom nama hanya boleh berisi huruf, angka, tanda hubung (-), atau underscore (_).',
            'custom_code.unique' => 'Custom nama tersebut sudah dipakai, silakan pilih nama lain.',
            'custom_code.min' => 'Custom nama minimal 3 karakter.',
        ]);

        $shortCode = !empty($validated['custom_code'])
            ? trim($validated['custom_code'])
            : $this->generateUniqueCode();

        $shortUrl = ShortUrl::create([
            'original_url' => $validated['original_url'],
            'short_code' => $shortCode,
            'clicks' => 0,
        ]);

        $this->putCache($shortCode, $validated['original_url']);

        return response()->json([
            'success' => true,
            'message' => 'Short URL berhasil dibuat!',
            'data' => $this->formatShortUrl($shortUrl),
        ], 201);
    }

    // 2. Ganti / setel ulang nama short_code dari link yang sudah ada
    public function updateCode(Request $request, string $code)
    {
        $shortUrl = ShortUrl::where('short_code', $code)->first();

        if (!$shortUrl) {
            return response()->json([
                'success' => false,
                'message' => 'Short URL lama tidak ditemukan.',
            ], 404);
        }

        $validated = $request->validate([
            'new_code' => [
                'required',
                'string',
                'min:3',
                'max:40',
                'regex:/^[A-Za-z0-9_-]+$/',
                'unique:short_urls,short_code,' . $shortUrl->id,
            ],
        ], [
            'new_code.required' => 'Nama short code baru wajib diisi.',
            'new_code.regex' => 'Nama baru hanya boleh berisi huruf, angka, tanda hubung (-), atau underscore (_).',
            'new_code.unique' => 'Nama baru tersebut sudah dipakai link lain.',
            'new_code.min' => 'Nama baru minimal 3 karakter.',
        ]);

        $oldCode = $shortUrl->short_code;
        $newCode = trim($validated['new_code']);

        $shortUrl->update([
            'short_code' => $newCode,
        ]);

        $this->forgetCache($oldCode);
        $this->putCache($newCode, $shortUrl->original_url);

        return response()->json([
            'success' => true,
            'message' => "Nama short URL berhasil diubah dari '{$oldCode}' menjadi '{$newCode}'.",
            'data' => [
                ...$this->formatShortUrl($shortUrl->fresh()),
                'previous_code' => $oldCode,
            ],
        ], 200);
    }

    // 3. Redirect sekaligus hitung klik
    public function redirect(string $code)
    {
        $originalUrl = $this->getCachedOrDbUrl($code);

        if (!$originalUrl) {
            return response()->json(['message' => 'URL tidak ditemukan.'], 404);
        }

        ShortUrl::where('short_code', $code)->increment('clicks');

        return redirect()->away($originalUrl);
    }

    // 4. Cek statistik klik
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
                ...$this->formatShortUrl($shortUrl),
                'created_at' => $shortUrl->created_at,
                'updated_at' => $shortUrl->updated_at,
            ],
        ], 200);
    }

    private function formatShortUrl(ShortUrl $shortUrl): array
    {
        return [
            'original_url' => $shortUrl->original_url,
            'short_code' => $shortUrl->short_code,
            'short_url' => url('/api/' . $shortUrl->short_code),
            'clicks' => (int) $shortUrl->clicks,
        ];
    }

    private function generateUniqueCode(): string
    {
        do {
            $code = Str::random(6);
        } while (ShortUrl::where('short_code', $code)->exists());

        return $code;
    }

    private function putCache(string $code, string $originalUrl): void
    {
        try {
            Cache::put('short_url:' . $code, $originalUrl, now()->addHours(24));
        } catch (\Throwable) {
            // Aman jika cache store tidak tersedia
        }
    }

    private function forgetCache(string $code): void
    {
        try {
            Cache::forget('short_url:' . $code);
        } catch (\Throwable) {
            // Aman jika cache store tidak tersedia
        }
    }

    private function getCachedOrDbUrl(string $code): ?string
    {
        try {
            return Cache::remember('short_url:' . $code, now()->addHours(24), function () use ($code) {
                $shortUrl = ShortUrl::where('short_code', $code)->first();
                return $shortUrl ? $shortUrl->original_url : null;
            });
        } catch (\Throwable) {
            $shortUrl = ShortUrl::where('short_code', $code)->first();
            return $shortUrl ? $shortUrl->original_url : null;
        }
    }
}