# Wemof Lab

Wemofの公開情報を「検証可能な仮説」に分解し、USD/JPY 5分足OHLC CSVをブラウザ内で解析する研究用Webアプリです。

## 主な機能
- ボリンジャーバンド ±σ候補抽出
- 独自の値動き「純度」スコア
- 経済指標/ニュースCSV、直近高安値ブレイク、ラウンドナンバーによる理由あり除外
- Wemof Score（異常度・純度・理由なし度）
- TP/SL先行判定、MAE/MFE、期待値
- 単純±σ → 純度 → 理由除外のフィルター比較
- SL 20 / 50 / 100 pips のテールリスク比較
- 結果CSV出力
- PWA / オフライン対応

## 重要
公式Wemofアプリではありません。公開情報を研究用に数値化した **Wemof-like仮説モデル** です。実売買や投資助言は行いません。

## 公開
GitHub Pages: https://branzfamily01.github.io/wemof-lab/
Manual: https://branzfamily01.github.io/wemof-lab/manual.html
