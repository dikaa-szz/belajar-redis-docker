<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;

Route::get('/test', function () {
    return response()->json([
        'message' => 'OK'
    ]);
});

// Tambahkan route POST ini
Route::post('/shorten', function (Request $request) {
    // Validasi input sederhana untuk memastikan yang dikirim adalah URL valid
    $request->validate([
        'original_url' => 'required|url'
    ]);

    // Membuat kode acak sepanjang 6 karakter untuk URL pendek
    $shortCode = Str::random(6);

    return response()->json([
        'success' => true,
        'message' => 'URL berhasil dipendekkan!',
        'data' => [
            'original_url' => $request->original_url,
            'short_code' => $shortCode,
            'short_url' => url('/api/' . $shortCode)
        ]
    ], 201);
});