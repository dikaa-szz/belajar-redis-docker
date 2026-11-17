<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\UrlController;

Route::get('/', function () {
    return view('welcome');
});

Route::post('/api/shorten', [UrlController::class, 'store']);
Route::get('/{shortCode}', [UrlController::class, 'redirect'])->where('shortCode', '[A-Za-z0-9]+');