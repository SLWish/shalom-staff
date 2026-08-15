package com.shalom.guildadmin;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Map<String, GuildControls> guildControls = new LinkedHashMap<>();
    private Switch globalSwitch;
    private Button saveButton;
    private TextView statusText;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        buildUi();
        loadSettings();
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private TextView text(String value, int size, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(Color.rgb(21, 25, 35));
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private void buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.rgb(245, 247, 251));
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(28), dp(20), dp(36));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int top;
            int bottom;
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                top = bars.top;
                bottom = bars.bottom;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
            }
            view.setPadding(dp(20), dp(28) + top, dp(20), dp(36) + bottom);
            return insets;
        });
        scroll.addView(root);

        TextView eyebrow = text("SHALOM STAFF", 12, true);
        eyebrow.setTextColor(Color.rgb(101, 88, 232));
        root.addView(eyebrow);
        TextView title = text("경고 설정", 32, true);
        title.setPadding(0, dp(6), 0, dp(5));
        root.addView(title);
        TextView subtitle = text("저장하면 길드 웹앱에 바로 반영됩니다.", 14, false);
        subtitle.setTextColor(Color.rgb(104, 112, 131));
        subtitle.setPadding(0, 0, 0, dp(22));
        root.addView(subtitle);

        globalSwitch = new Switch(this);
        globalSwitch.setText("전체 경고 기능");
        globalSwitch.setTextSize(18);
        globalSwitch.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        globalSwitch.setPadding(dp(18), dp(16), dp(12), dp(16));
        globalSwitch.setBackgroundColor(Color.WHITE);
        root.addView(globalSwitch, new LinearLayout.LayoutParams(-1, -2));

        String[][] guilds = {{"ShaLom", "1군", "40000"}, {"ShaLom2", "2군", "15000"}, {"ShaLom3", "3군", "7000"}, {"ShaLom4", "4군", "3000"}};
        for (String[] guild : guilds) root.addView(createGuildCard(guild[0], guild[1], guild[2]));

        saveButton = new Button(this);
        saveButton.setText("설정 적용");
        saveButton.setTextColor(Color.WHITE);
        saveButton.setTextSize(17);
        saveButton.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        saveButton.setBackgroundColor(Color.rgb(101, 88, 232));
        saveButton.setOnClickListener(v -> saveSettings());
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(-1, dp(56));
        buttonParams.setMargins(0, dp(24), 0, 0);
        root.addView(saveButton, buttonParams);

        statusText = text("현재 설정을 불러오는 중…", 13, false);
        statusText.setTextColor(Color.rgb(104, 112, 131));
        statusText.setGravity(Gravity.CENTER);
        statusText.setPadding(0, dp(14), 0, 0);
        root.addView(statusText);
        setContentView(scroll);
    }

    private View createGuildCard(String guildName, String label, String defaultScore) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(18), dp(15), dp(18), dp(16));
        card.setBackgroundColor(Color.WHITE);
        LinearLayout.LayoutParams cardParams = new LinearLayout.LayoutParams(-1, -2);
        cardParams.setMargins(0, dp(12), 0, 0);
        card.setLayoutParams(cardParams);

        Switch enabled = new Switch(this);
        enabled.setText(label + " · " + guildName);
        enabled.setTextSize(17);
        enabled.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        enabled.setChecked(true);
        card.addView(enabled, new LinearLayout.LayoutParams(-1, -2));

        TextView scoreLabel = text("경고 기준 점수", 12, true);
        scoreLabel.setTextColor(Color.rgb(104, 112, 131));
        scoreLabel.setPadding(0, dp(13), 0, dp(6));
        card.addView(scoreLabel);
        EditText score = new EditText(this);
        score.setInputType(InputType.TYPE_CLASS_NUMBER);
        score.setText(defaultScore);
        score.setTextSize(20);
        score.setSelectAllOnFocus(true);
        score.setPadding(dp(12), dp(8), dp(12), dp(8));
        card.addView(score, new LinearLayout.LayoutParams(-1, dp(52)));
        guildControls.put(guildName, new GuildControls(enabled, score));
        return card;
    }

    private void setBusy(boolean busy, String message) {
        saveButton.setEnabled(!busy);
        statusText.setText(message);
    }

    private void loadSettings() {
        setBusy(true, "현재 설정을 불러오는 중…");
        executor.execute(() -> {
            try {
                JSONObject data = request("GET", null);
                runOnUiThread(() -> applySettings(data));
            } catch (Exception error) {
                runOnUiThread(() -> setBusy(false, "불러오기 실패 · 인터넷 연결을 확인해주세요."));
            }
        });
    }

    private void applySettings(JSONObject data) {
        globalSwitch.setChecked(data.optBoolean("warningsEnabled", true));
        JSONObject guilds = data.optJSONObject("guilds");
        if (guilds != null) for (Map.Entry<String, GuildControls> entry : guildControls.entrySet()) {
            JSONObject guild = guilds.optJSONObject(entry.getKey());
            if (guild == null) continue;
            entry.getValue().enabled.setChecked(guild.optBoolean("enabled", true));
            entry.getValue().score.setText(String.valueOf(guild.optInt("cutScore", 0)));
        }
        String updatedAt = data.optString("updatedAt", "");
        setBusy(false, updatedAt.isEmpty() ? "현재 설정을 불러왔습니다." : "마지막 적용 " + formatTime(updatedAt));
    }

    private void saveSettings() {
        if (BuildConfig.WARNING_ADMIN_TOKEN.isEmpty()) {
            statusText.setText("관리자 키가 포함되지 않은 APK입니다.");
            return;
        }
        try {
            JSONObject payload = new JSONObject();
            payload.put("warningsEnabled", globalSwitch.isChecked());
            JSONObject guilds = new JSONObject();
            for (Map.Entry<String, GuildControls> entry : guildControls.entrySet()) {
                String raw = entry.getValue().score.getText().toString().replace(",", "").trim();
                long value = Long.parseLong(raw);
                if (value < 0 || value > 1000000000L) throw new NumberFormatException();
                JSONObject guild = new JSONObject();
                guild.put("enabled", entry.getValue().enabled.isChecked());
                guild.put("cutScore", value);
                guilds.put(entry.getKey(), guild);
            }
            payload.put("guilds", guilds);
            setBusy(true, "설정을 적용하는 중…");
            executor.execute(() -> {
                try {
                    JSONObject saved = request("POST", payload);
                    runOnUiThread(() -> { applySettings(saved); statusText.setText("적용 완료 · 길드 웹앱에 반영됐습니다."); });
                } catch (Exception error) {
                    runOnUiThread(() -> setBusy(false, "적용 실패 · 서버 설정을 확인해주세요."));
                }
            });
        } catch (Exception error) {
            statusText.setText("기준 점수를 숫자로 입력해주세요.");
        }
    }

    private JSONObject request(String method, JSONObject body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(BuildConfig.API_URL).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(12000);
        connection.setRequestProperty("Accept", "application/json");
        if (method.equals("POST")) {
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Authorization", "Bearer " + BuildConfig.WARNING_ADMIN_TOKEN);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
        }
        int status = connection.getResponseCode();
        BufferedReader reader = new BufferedReader(new InputStreamReader(status < 400 ? connection.getInputStream() : connection.getErrorStream(), StandardCharsets.UTF_8));
        StringBuilder response = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) response.append(line);
        reader.close();
        connection.disconnect();
        if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status);
        return new JSONObject(response.toString());
    }

    private String formatTime(String iso) {
        try {
            SimpleDateFormat source = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            source.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date date = source.parse(iso.substring(0, 19));
            SimpleDateFormat output = new SimpleDateFormat("MM.dd HH:mm", Locale.KOREA);
            output.setTimeZone(TimeZone.getTimeZone("Asia/Seoul"));
            return output.format(date);
        } catch (Exception ignored) { return iso; }
    }

    @Override protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private static class GuildControls {
        final Switch enabled;
        final EditText score;
        GuildControls(Switch enabled, EditText score) { this.enabled = enabled; this.score = score; }
    }
}
