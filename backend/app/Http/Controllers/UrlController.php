<?php

namespace App\Http\Controllers;

use App\Models\Url;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

class UrlController extends Controller
{
    // Generate short URL
    public function store(Request $request)
    {
        $request->validate([
            'original_url' => 'required|url',
        ]);

        // Cek apakah URL sudah pernah di-shorten
        $existing = Url::where('original_url', $request->original_url)->first();
        if ($existing) {
            return response()->json([
                'short_url' => url($existing->short_code),
                'short_code' => $existing->short_code,
                'original_url' => $existing->original_url,
            ]);
        }

        // Generate unique short code
        do {
            $shortCode = Str::random(6);
        } while (Url::where('short_code', $shortCode)->exists());

        // Simpan ke database
        $url = Url::create([
            'original_url' => $request->original_url,
            'short_code' => $shortCode,
            'clicks' => 0,
        ]);

        // Simpan ke Redis (cache)
        Cache::put("url:{$shortCode}", $url->original_url, now()->addDays(30));

        return response()->json([
            'short_url' => url($shortCode),
            'short_code' => $shortCode,
            'original_url' => $url->original_url,
        ], 201);
    }

    // Redirect + hit counter
    public function redirect($shortCode)
    {
        // Coba ambil dari Redis dulu
        $originalUrl = Cache::get("url:{$shortCode}");

        if (!$originalUrl) {
            // Kalau tidak ada di Redis, ambil dari database
            $url = Url::where('short_code', $shortCode)->firstOrFail();
            $originalUrl = $url->original_url;

            // Simpan lagi ke Redis
            Cache::put("url:{$shortCode}", $originalUrl, now()->addDays(30));
        } else {
            $url = Url::where('short_code', $shortCode)->first();
        }

        // Tambah hit counter di Redis
        Cache::increment("clicks:{$shortCode}");

        // Update clicks di database (opsional, bisa di-queue nanti)
        if ($url) {
            $url->increment('clicks');
        }

        return redirect()->away($originalUrl);
    }
}