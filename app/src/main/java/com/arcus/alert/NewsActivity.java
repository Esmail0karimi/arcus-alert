package com.arcus.alert;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;

/**
 * News & economic calendar, and the company report window.
 * Both are the web app opened in embed mode (?embed=news / ?embed=report&sym=META), so the data,
 * Persian text and layout are exactly what the website shows.
 */
public class NewsActivity extends Activity {
    public static final String EXTRA_SYMBOL = "symbol";
    private WebView web;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(4, 12, 25));
        getWindow().setNavigationBarColor(Color.rgb(4, 12, 25));
        FrameLayout box = new FrameLayout(this);
        box.setBackgroundColor(Color.rgb(4, 12, 25));
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(4, 12, 25));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        final ProgressBar bar = new ProgressBar(this);
        final String base = BuildConfig.WEB_BASE;
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, android.webkit.WebResourceRequest r) {
                Uri u = r.getUrl();
                if (u.toString().startsWith(base)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
            @Override public void onPageFinished(WebView v, String url) { bar.setVisibility(View.GONE); }
        });
        web.setWebChromeClient(new WebChromeClient());
        box.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.gravity = android.view.Gravity.CENTER;
        box.addView(bar, lp);
        setContentView(box);
        String sym = getIntent().getStringExtra(EXTRA_SYMBOL);
        String url = base + (base.endsWith("/") ? "" : "/") + "?embed=" + (sym == null || sym.isEmpty() ? "news" : "report&sym=" + Uri.encode(sym));
        web.loadUrl(url);
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
