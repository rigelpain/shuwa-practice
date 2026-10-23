/**
 * A starter list of everyday words and set phrases. These are only the words:
 * the signs themselves must be recorded by a signer, since there is no openly
 * licensed motion data for Japanese Sign Language to ship with the app.
 */
export const STARTER_VOCABULARY: ReadonlyArray<{ category: string; words: readonly string[] }> = [
  {
    category: 'あいさつ',
    words: ['おはよう', 'こんにちは', 'こんばんは', 'おやすみ', 'ありがとう', 'ごめんなさい', 'さようなら', 'また'],
  },
  {
    category: '返事・気持ち',
    words: [
      'はい',
      'いいえ',
      'わかる',
      'わからない',
      '大丈夫',
      '好き',
      '嫌い',
      'うれしい',
      '悲しい',
      '楽しい',
      '困る',
      '疲れた',
      'いい',
      'だめ',
    ],
  },
  {
    category: '質問',
    words: ['何', '誰', 'どこ', 'いつ', 'どうして', 'どう', 'いくつ', 'いくら'],
  },
  {
    category: '人・家族',
    words: ['私', 'あなた', '彼', '彼女', '友達', '家族', '父', '母', '兄', '姉', '弟', '妹', '子ども', '名前'],
  },
  {
    category: '時',
    words: ['今', '今日', '明日', '昨日', '朝', '昼', '夜', '時間', '週', '月', '年', '前', '後'],
  },
  {
    category: '数',
    words: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '100', '1000'],
  },
  {
    category: '動作',
    words: ['食べる', '飲む', '行く', '来る', '見る', '会う', '待つ', '話す', '覚える', '教える', '勉強', '仕事', '休む'],
  },
  {
    category: '場所・もの',
    words: ['家', '学校', '会社', '病院', '駅', 'トイレ', '水', 'お金', '電話', 'メール'],
  },
  {
    category: '手話の会話',
    words: ['手話', 'ろう者', '聞こえる', '聞こえない', '指文字', '通訳'],
  },
  {
    category: 'よく使う言い回し',
    words: [
      'はじめまして',
      'よろしくお願いします',
      'お疲れさまです',
      'お元気ですか',
      'どういたしまして',
      '気にしないで',
      'わかりました',
      'もう一度お願いします',
      'ゆっくりお願いします',
      '少し待ってください',
      'おめでとう',
      'お大事に',
      'いただきます',
      'ごちそうさま',
      'お先に失礼します',
    ],
  },
];
