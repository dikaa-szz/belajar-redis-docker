<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\ShortUrlController;

Route::get('/test', function () {
    return response()->json([
        'message' => 'OK'
    ]);
});

// Endpoint untuk membuat Short URL
Route::post('/shorten', [ShortUrlController::class, 'store']);

// Endpoint untuk melihat statistik (Wajib di atas route /{code} agar tidak dianggap sebagai short code)
Route::get('/stats/{code}', [ShortUrlController::class, 'stats']);

// Endpoint untuk redirect sekaligus menghitung klik (Click Counter)
Route::get('/{code}', [ShortUrlController::class, 'redirect']);