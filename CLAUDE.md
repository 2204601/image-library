# Stockroom

集めたものを何でもストックしておける、ローカルの保管庫アプリ（Tauri 2 / macOS・Windows）。

## 開発の基準

開発の Standard・Recommendations・Playbook は **`../desktop-platform/ai/ONBOARDING.md`** を最初に参照すること。Web アプリ向けの ai-dev-platform は参照しない。

## このツール固有

- **画面の原則：[docs/UI.md](docs/UI.md)。** 表示（ビュー・モード・レイアウト・選択・グループ分け）を切り替えても、操作の位置と大きさを変えない。画面に触れる変更の前に読む
- 設計の境界：`docs/ARCHITECTURE.md`
- 機能ごとの決定：`docs/<topic>.md`（一覧は README の「ドキュメント」）
- 操作はコマンド表 `src/lib/commands.ts` にまず足す
- Rust コマンドは `src/lib/api.ts` のラッパ経由で呼ぶ。モック `src/dev/mockBackend.ts` も同じ PR で更新する

## コマンド

```bash
npm install
npm run tauri dev      # アプリを起動
npm run dev            # ブラウザで UI だけ（モック）
npm test               # cargo test + tsc --noEmit
npm run tauri build    # 配布用ビルド（署名鍵が要る）
```

## 変えないもの

`identifier`、`productName`、updater の `pubkey` と `endpoints`、待ち受けポート、CSP の緩和、capabilities の追加は人の判断なしに変えない。
