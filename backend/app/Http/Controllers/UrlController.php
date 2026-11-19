<?php

namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Models\ShortUrl;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

class ShortUrlController extends Controller
{
    // 1. Endpoint untuk membuat Short URL
    public function store(Request $request)
    {
        $request->validate([
            'original_url' => 'required|url'
        ]);

        $shortCode = Str::random(6);

        $shortUrl = ShortUrl::create([
            'original_url' => $request->original_url,
            'short_code' => $shortCode,
            'clicks' => 0
        ]);

        // Cache data ke Redis (durasi 24 jam)
        Cache::put('short_url:' . $shortCode, $request->original_url, now()->addHours(24));

        return response()->json([
            'success' => true,
            'message' => 'URL berhasil dibuat dan disimpan!',
            'data' => [
                'original_url' => $shortUrl->original_url,
                'short_code' => $shortUrl->short_code,
                'short_url' => url('/api/' . $shortUrl->short_code),
                'clicks' => $shortUrl->clicks
            ]
        ], 201);
    }
    // 2. Endpoint untuk Redirect sekaligus Menghitung Klik (Click Counter)
    public function redirect($code)
    {
        // Ambil URL asli dari Redis Cache, atau fallback ke Database MySQL jika cache kosong
        $originalUrl = Cache::remember('short_url:' . $code, now()->addHours(24), function () use ($code) {
            $shortUrl = ShortUrl::where('short_code', $code)->first();
            return $shortUrl ? $shortUrl->original_url : null;
        });

        if (!$originalUrl) {
            return response()->json(['message' => 'URL tidak ditemukan.'], 404);
        }

        // Tambahkan jumlah klik di database MySQL secara otomatis
        ShortUrl::where('short_code', $code)->increment('clicks');

        // Redirect ke URL asli tujuan
        return redirect()->away($originalUrl);
    }

    // 3. Endpoint untuk melihat statistik jumlah klik
    public function stats($code)
    {
        $shortUrl = ShortUrl::where('short_code', $code)->first();

        if (!$shortUrl) {
            return response()->json([
                'success' => false,
                'message' => 'URL tidak ditemukan.'
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
                'updated_at' => $shortUrl->updated_at
            ]
        ], 200);
    }
}