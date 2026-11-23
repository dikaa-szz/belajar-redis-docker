<?php

use App\Http\Controllers\Api\ShortUrlController;
use Illuminate\Support\Facades\Route;

Route::get('/test', function () {
    return response()->json([
        'success' => true,
        'message' => 'OK',
    ]);
});

Route::post('/shorten', [ShortUrlController::class, 'store']);

Route::patch('/urls/{code}', [ShortUrlController::class, 'updateCode'])
    ->where('code', '[A-Za-z0-9_-]+');

Route::get('/stats/{code}', [ShortUrlController::class, 'stats'])
    ->where('code', '[A-Za-z0-9_-]+');

Route::get('/{code}', [ShortUrlController::class, 'redirect'])
    ->where('code', '[A-Za-z0-9_-]+');