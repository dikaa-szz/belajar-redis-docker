<?php

use App\Http\Controllers\Api\ShortUrlController;
use Illuminate\Support\Facades\Route;

Route::get('/test', function () {
    return response()->json([
        'success' => true,
        'message' => 'OK',
    ]);
});

// Endpoint untuk membuat Short URL
Route::post('/shorten', [ShortUrlController::class, 'store']);

// Endpoint untuk melihat statistik (wajib di atas route /{code})
Route::get('/stats/{code}', [ShortUrlController::class, 'stats'])
    ->where('code', '[A-Za-z0-9_-]+');

// Endpoint untuk redirect sekaligus menghitung klik (Click Counter)
Route::get('/{code}', [ShortUrlController::class, 'redirect'])
    ->where('code', '[A-Za-z0-9_-]+');