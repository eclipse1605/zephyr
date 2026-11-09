type Line = Record<string, string>;

const ADVICE: Record<string, Line> = {
  "Good|children": { en: "Normal outdoor activity is fine.", hi: "बाहर सामान्य गतिविधि ठीक है।", mr: "बाहेरची सामान्य हालचाल ठीक आहे.", bn: "বাইরে স্বাভাবিক কাজ ঠিক আছে।", ta: "வெளியே சாதாரண செயல்பாடு நல்லது.", kn: "ಹೊರಗೆ ಸಾಮಾನ್ಯ ಚಟುವಟಿಕೆ ಸರಿ.", te: "బయట సాధారణ కార్యకలాపం సరే.", zh: "正常户外活动没问题。", ru: "Обычная активность на улице безопасна.", ar: "النشاط الخارجي العادي مناسب.", id: "Aktivitas luar biasa aman.", pt: "Atividade ao ar livre normal está bem." },
  "Good|elderly": { en: "Normal outdoor activity is fine.", hi: "बाहर सामान्य गतिविधि ठीक है।", mr: "बाहेरची सामान्य हालचाल ठीक आहे.", bn: "বাইরে স্বাভাবিক কাজ ঠিক আছে।", ta: "வெளியே சாதாரண செயல்பாடு நல்லது.", kn: "ಹೊರಗೆ ಸಾಮಾನ್ಯ ಚಟುವಟಿಕೆ ಸರಿ.", te: "బయట సాధారణ కార్యకలాపం సరే.", zh: "正常户外活动没问题。", ru: "Обычная активность на улице безопасна.", ar: "النشاط الخارجي العادي مناسب.", id: "Aktivitas luar biasa aman.", pt: "Atividade ao ar livre normal está bem." },
  "Good|asthma_heart": { en: "Normal outdoor activity is fine; keep medication nearby.", hi: "बाहर सामान्य गतिविधि ठीक है; दवा पास रखें।", mr: "बाहेरची सामान्य हालचाल ठीक आहे; औषध जवळ ठेवा.", bn: "বাইরে স্বাভাবিক কাজ ঠিক; ওষুধ কাছে রাখুন।", ta: "வெளியே சாதாரண செயல்பாடு நல்லது; மருந்தை அருகில் வையுங்கள்.", kn: "ಹೊರಗೆ ಸಾಮಾನ್ಯ ಚಟುವಟಿಕೆ ಸರಿ; ಔಷಧವನ್ನು ಹತ್ತಿರ ಇಡಿ.", te: "బయట సాధారణ కార్యకలాపం సరే; మందు దగ్గర ఉంచండి.", zh: "正常户外活动没问题，把药放在身边。", ru: "Обычная активность безопасна; держите лекарство рядом.", ar: "النشاط الخارجي العادي مناسب؛ أبقِ الدواء قريبًا.", id: "Aktivitas luar biasa aman; simpan obat di dekat Anda.", pt: "Atividade normal está bem; mantenha o remédio por perto." },
  "Good|outdoor_workers": { en: "Normal outdoor work is fine.", hi: "बाहर का सामान्य काम ठीक है।", mr: "बाहेरचे सामान्य काम ठीक आहे.", bn: "বাইরের স্বাভাবিক কাজ ঠিক আছে।", ta: "வெளிப்புற சாதாரண வேலை நல்லது.", kn: "ಹೊರಗಿನ ಸಾಮಾನ್ಯ ಕೆಲಸ ಸರಿ.", te: "బయట సాధారణ పని సరే.", zh: "正常户外工作没问题。", ru: "Обычная работа на улице безопасна.", ar: "العمل الخارجي العادي مناسب.", id: "Kerja luar biasa aman.", pt: "Trabalho ao ar livre normal está bem." },
  "Good|everyone_else": { en: "Air quality is satisfactory for most people.", hi: "अधिकतर लोगों के लिए हवा ठीक है।", mr: "बहुतेक लोकांसाठी हवा समाधानकारक आहे.", bn: "বেশিরভাগ মানুষের জন্য বাতাস সন্তোষজনক।", ta: "பெரும்பாலானவர்களுக்கு காற்று நன்றாக உள்ளது.", kn: "ಹೆಚ್ಚಿನ ಜನರಿಗೆ ಗಾಳಿ ಸರಿ.", te: "చాలా మందికి గాలి సరిపోతుంది.", zh: "对大多数人来说空气令人满意。", ru: "Воздух удовлетворителен для большинства.", ar: "جودة الهواء مقبولة لمعظم الناس.", id: "Udara memuaskan bagi kebanyakan orang.", pt: "O ar é satisfatório para a maioria." },
  "Satisfactory|children": { en: "Sensitive children may prefer shorter outdoor play.", hi: "संवेदनशील बच्चे कम देर बाहर खेलें।", mr: "संवेदनशील मुलांनी कमी वेळ बाहेर खेळावे.", bn: "সংবেদনশীল শিশুরা কম সময় বাইরে খেলুক।", ta: "உணர்திறன் குழந்தைகள் குறைந்த நேரம் வெளியே விளையாடலாம்.", kn: "ಸೂಕ್ಷ್ಮ ಮಕ್ಕಳು ಕಡಿಮೆ ಹೊತ್ತು ಹೊರಗೆ ಆಡಲಿ.", te: "సున్నితమైన పిల్లలు తక్కువ సేపు బయట ఆడాలి.", zh: "敏感儿童宜缩短户外玩耍。", ru: "Чувствительным детям лучше меньше играть на улице.", ar: "الأطفال الحساسون يفضّلون لعبًا خارجيًا أقصر.", id: "Anak sensitif sebaiknya bermain di luar lebih singkat.", pt: "Crianças sensíveis devem brincar menos ao ar livre." },
  "Satisfactory|elderly": { en: "Sensitive elders may prefer shorter outdoor time.", hi: "संवेदनशील बुजुर्ग कम देर बाहर रहें।", mr: "संवेदनशील ज्येष्ठांनी कमी वेळ बाहेर राहावे.", bn: "সংবেদনশীল প্রবীণরা কম সময় বাইরে থাকুন।", ta: "உணர்திறன் மூத்தோர் குறைந்த நேரம் வெளியே இருக்கலாம்.", kn: "ಸೂಕ್ಷ್ಮ ಹಿರಿಯರು ಕಡಿಮೆ ಹೊತ್ತು ಹೊರಗೆ ಇರಲಿ.", te: "సున్నితమైన వృద్ధులు తక్కువ సేపు బయట ఉండాలి.", zh: "敏感老人宜缩短户外时间。", ru: "Чувствительным пожилым лучше меньше быть на улице.", ar: "كبار السن الحساسون يفضّلون وقتًا خارجيًا أقصر.", id: "Lansia sensitif sebaiknya di luar lebih singkat.", pt: "Idosos sensíveis devem ficar menos ao ar livre." },
  "Satisfactory|asthma_heart": { en: "Limit prolonged outdoor exertion if symptoms appear.", hi: "लक्षण हों तो लंबी बाहरी मेहनत कम करें।", mr: "लक्षण दिसल्यास दीर्घ बाह्य श्रम कमी करा.", bn: "লক্ষণ দেখা দিলে দীর্ঘ বাইরের পরিশ্রম কমান।", ta: "அறிகுறிகள் வந்தால் நீண்ட வெளிப்புற உழைப்பை குறைக்கவும்.", kn: "ಲಕ್ಷಣಗಳಿದ್ದರೆ ದೀರ್ಘ ಹೊರಗಿನ ಶ್ರಮ ಕಡಿಮೆ ಮಾಡಿ.", te: "లక్షణాలు వస్తే ఎక్కువసేపు బయట శ్రమ తగ్గించండి.", zh: "出现症状时减少长时间户外用力。", ru: "При симптомах сократите долгую нагрузку на улице.", ar: "قلّل الجهد الخارجي الطويل إذا ظهرت أعراض.", id: "Kurangi kerja berat di luar jika gejala muncul.", pt: "Reduza esforço longo ao ar livre se houver sintomas." },
  "Satisfactory|outdoor_workers": { en: "Take short breaks during heavy exertion.", hi: "भारी मेहनत के दौरान छोटे ब्रेक लें।", mr: "जड श्रमात छोटे विश्रांती घ्या.", bn: "ভারী পরিশ্রমে ছোট বিরতি নিন।", ta: "கடுமையான உழைப்பில் சிறு இடைவேளை எடுங்கள்.", kn: "ಭಾರಿ ಶ್ರಮದಲ್ಲಿ ಚಿಕ್ಕ ವಿರಾಮ ತೆಗೆದುಕೊಳ್ಳಿ.", te: "భారీ శ్రమలో చిన్న విరామాలు తీసుకోండి.", zh: "重体力时短暂停歇。", ru: "При тяжёлой нагрузке делайте короткие паузы.", ar: "خذ استراحات قصيرة أثناء الجهد الشديد.", id: "Istirahat singkat saat kerja berat.", pt: "Faça pausas curtas no esforço pesado." },
  "Satisfactory|everyone_else": { en: "Acceptable air for most people.", hi: "अधिकतर लोगों के लिए हवा स्वीकार्य है।", mr: "बहुतेकांसाठी हवा स्वीकारार्ह आहे.", bn: "বেশিরভাগের জন্য বাতাস গ্রহণযোগ্য।", ta: "பெரும்பாலானவர்களுக்கு காற்று ஏற்கத்தக்கது.", kn: "ಹೆಚ್ಚಿನವರಿಗೆ ಗಾಳಿ ಸ್ವೀಕಾರಾರ್ಹ.", te: "చాలా మందికి గాలి ఆమోదయోగ్యం.", zh: "对大多数人空气可接受。", ru: "Воздух приемлем для большинства.", ar: "الهواء مقبول لمعظم الناس.", id: "Udara dapat diterima bagi kebanyakan orang.", pt: "Ar aceitável para a maioria." },
  "Moderate|children": { en: "Reduce prolonged outdoor play, especially for sensitive children.", hi: "लंबा बाहरी खेल कम करें, खासकर संवेदनशील बच्चों का।", mr: "दीर्घ बाह्य खेळ कमी करा, विशेषतः संवेदनशील मुलांचा.", bn: "দীর্ঘ বাইরের খেলা কমান, বিশেষ করে সংবেদনশীল শিশুদের।", ta: "நீண்ட வெளிப்புற விளையாட்டை குறைக்கவும், குறிப்பாக உணர்திறன் குழந்தைகளுக்கு.", kn: "ದೀರ್ಘ ಹೊರಾಟ ಕಡಿಮೆ ಮಾಡಿ, ವಿಶೇಷವಾಗಿ ಸೂಕ್ಷ್ಮ ಮಕ್ಕಳಿಗೆ.", te: "ఎక్కువసేపు బయట ఆట తగ్గించండి, ముఖ్యంగా సున్నితమైన పిల్లలకు.", zh: "减少长时间户外玩耍，敏感儿童尤其如此。", ru: "Сократите долгие игры на улице, особенно чувствительным детям.", ar: "قلّل اللعب الخارجي الطويل، خاصة للأطفال الحساسين.", id: "Kurangi main di luar yang lama, terutama anak sensitif.", pt: "Reduza brincadeiras longas ao ar livre, sobretudo crianças sensíveis." },
  "Moderate|elderly": { en: "Reduce prolonged outdoor activity.", hi: "लंबी बाहरी गतिविधि कम करें।", mr: "दीर्घ बाह्य हालचाल कमी करा.", bn: "দীর্ঘ বাইরের কাজ কমান।", ta: "நீண்ட வெளிப்புற செயல்பாட்டை குறைக்கவும்.", kn: "ದೀರ್ಘ ಹೊರಗಿನ ಚಟುವಟಿಕೆ ಕಡಿಮೆ ಮಾಡಿ.", te: "ఎక్కువసేపు బయట కార్యకలాపం తగ్గించండి.", zh: "减少长时间户外活动。", ru: "Сократите долгую активность на улице.", ar: "قلّل النشاط الخارجي الطويل.", id: "Kurangi aktivitas luar yang lama.", pt: "Reduza atividade longa ao ar livre." },
  "Moderate|asthma_heart": { en: "Avoid heavy outdoor exertion; watch for symptoms.", hi: "भारी बाहरी मेहनत से बचें; लक्षण देखें।", mr: "जड बाह्य श्रम टाळा; लक्षणे पाहा.", bn: "ভারী বাইরের পরিশ্রম এড়ান; লক্ষণ দেখুন।", ta: "கடுமையான வெளிப்புற உழைப்பை தவிர்க்கவும்; அறிகுறிகளை கவனியுங்கள்.", kn: "ಭಾರಿ ಹೊರಗಿನ ಶ್ರಮ ತಪ್ಪಿಸಿ; ಲಕ್ಷಣ ನೋಡಿ.", te: "భారీ బయట శ్రమను నివారించండి; లక్షణాలు చూడండి.", zh: "避免剧烈户外用力，留意症状。", ru: "Избегайте тяжёлой нагрузки на улице; следите за симптомами.", ar: "تجنّب الجهد الخارجي الشديد؛ راقب الأعراض.", id: "Hindari kerja berat di luar; perhatikan gejala.", pt: "Evite esforço pesado ao ar livre; observe sintomas." },
  "Moderate|outdoor_workers": { en: "Schedule heavy tasks for cleaner hours if possible.", hi: "हो सके तो भारी काम साफ हवा वाले समय में करें।", mr: "शक्य असल्यास जड कामे स्वच्छ हवेच्या वेळेत करा.", bn: "সম্ভব হলে ভারী কাজ পরিষ্কার বাতাসের সময়ে করুন।", ta: "முடிந்தால் கடின வேலையை தூய்மையான நேரத்தில் செய்யுங்கள்.", kn: "ಸಾಧ್ಯವಾದರೆ ಭಾರಿ ಕೆಲಸವನ್ನು ಶುದ್ಧ ಗಾಳಿಯ ವೇಳೆಗೆ ಇಡಿ.", te: "వీలైతే భారీ పనిని శుభ్రమైన గాలి సమయంలో చేయండి.", zh: "尽量把重活安排在空气较好的时段。", ru: "По возможности планируйте тяжёлую работу на более чистые часы.", ar: "جدول الأعمال الشاقة في ساعات أنظف إن أمكن.", id: "Jadwalkan kerja berat saat udara lebih bersih jika bisa.", pt: "Marque tarefas pesadas para horas de ar mais limpo, se puder." },
  "Moderate|everyone_else": { en: "Sensitive people should reduce prolonged outdoor exertion.", hi: "संवेदनशील लोग लंबी बाहरी मेहनत कम करें।", mr: "संवेदनशील लोकांनी दीर्घ बाह्य श्रम कमी करावा.", bn: "সংবেদনশীল মানুষ দীর্ঘ বাইরের পরিশ্রম কমাবে।", ta: "உணர்திறன் உள்ளவர்கள் நீண்ட வெளிப்புற உழைப்பை குறைக்க வேண்டும்.", kn: "ಸೂಕ್ಷ್ಮ ಜನರು ದೀರ್ಘ ಹೊರಗಿನ ಶ್ರಮ ಕಡಿಮೆ ಮಾಡಬೇಕು.", te: "సున్నితమైన వారు ఎక్కువసేపు బయట శ్రమ తగ్గించాలి.", zh: "敏感人群应减少长时间户外用力。", ru: "Чувствительным людям стоит сократить долгую нагрузку на улице.", ar: "على الحساسين تقليل الجهد الخارجي الطويل.", id: "Orang sensitif sebaiknya mengurangi kerja berat di luar.", pt: "Pessoas sensíveis devem reduzir esforço longo ao ar livre." },
  "Poor|children": { en: "Avoid outdoor play; stay indoors with cleaner air if available.", hi: "बाहर खेलने से बचें; साफ हवा हो तो अंदर रहें।", mr: "बाहेर खेळणे टाळा; स्वच्छ हवा असल्यास आत रहा.", bn: "বাইরে খেলা এড়ান; পরিষ্কার বাতাস থাকলে ঘরে থাকুন।", ta: "வெளிப்புற விளையாட்டை தவிர்க்கவும்; தூய்மையான காற்று இருந்தால் உள்ளே இருங்கள்.", kn: "ಹೊರಗೆ ಆಡುವುದನ್ನು ತಪ್ಪಿಸಿ; ಶುದ್ಧ ಗಾಳಿ ಇದ್ದರೆ ಒಳಗೆ ಇರಿ.", te: "బయట ఆటను నివారించండి; శుభ్రమైన గాలి ఉంటే లోపల ఉండండి.", zh: "避免户外玩耍；如有更洁净空气就待在室内。", ru: "Не играйте на улице; оставайтесь в помещении с более чистым воздухом.", ar: "تجنّب اللعب خارجًا؛ ابقَ داخلًا بهواء أنظف إن وُجد.", id: "Hindari main di luar; tetap di dalam jika udaranya lebih bersih.", pt: "Evite brincar fora; fique em local com ar mais limpo, se houver." },
  "Poor|elderly": { en: "Avoid outdoor activity; stay indoors.", hi: "बाहरी गतिविधि से बचें; अंदर रहें।", mr: "बाह्य हालचाल टाळा; आत रहा.", bn: "বাইরের কাজ এড়ান; ঘরে থাকুন।", ta: "வெளிப்புற செயல்பாட்டை தவிர்க்கவும்; உள்ளே இருங்கள்.", kn: "ಹೊರಗಿನ ಚಟುವಟಿಕೆ ತಪ್ಪಿಸಿ; ಒಳಗೆ ಇರಿ.", te: "బయట కార్యకలాపం నివారించండి; లోపల ఉండండి.", zh: "避免户外活动，待在室内。", ru: "Избегайте улицы; оставайтесь в помещении.", ar: "تجنّب النشاط الخارجي؛ ابقَ داخلًا.", id: "Hindari aktivitas luar; tetap di dalam.", pt: "Evite atividade ao ar livre; fique em casa." },
  "Poor|asthma_heart": { en: "Stay indoors; use prescribed medication if needed.", hi: "अंदर रहें; जरूरत हो तो दी गई दवा लें।", mr: "आत रहा; गरज असल्यास दिलेले औषध घ्या.", bn: "ঘরে থাকুন; দরকার হলে নির্ধারিত ওষুধ নিন।", ta: "உள்ளே இருங்கள்; தேவைப்பட்டால் பரிந்துரைத்த மருந்தை பயன்படுத்துங்கள்.", kn: "ಒಳಗೆ ಇರಿ; ಬೇಕಾದರೆ ಸೂಚಿಸಿದ ಔಷಧ ಬಳಸಿ.", te: "లోపల ఉండండి; అవసరమైతే సూచించిన మందు వాడండి.", zh: "待在室内；需要时按医嘱用药。", ru: "Оставайтесь в помещении; при необходимости примите назначенное лекарство.", ar: "ابقَ داخلًا؛ استخدم الدواء الموصوف عند الحاجة.", id: "Tetap di dalam; gunakan obat yang diresepkan jika perlu.", pt: "Fique em casa; use o remédio prescrito se precisar." },
  "Poor|outdoor_workers": { en: "Limit outdoor work; use a suitable mask if work continues.", hi: "बाहरी काम सीमित करें; काम जारी हो तो उपयुक्त मास्क पहनें।", mr: "बाह्य काम मर्यादित करा; काम सुरू राहिल्यास योग्य मास्क वापरा.", bn: "বাইরের কাজ সীমিত করুন; কাজ চললে উপযুক্ত মাস্ক পরুন।", ta: "வெளிப்புற வேலையை குறைக்கவும்; வேலை தொடர்ந்தால் பொருத்தமான முகமூடி அணியுங்கள்.", kn: "ಹೊರಗಿನ ಕೆಲಸ ಮಿತಿಗೊಳಿಸಿ; ಕೆಲಸ ಮುಂದುವರಿದರೆ ಸೂಕ್ತ ಮಾಸ್ಕ್ ಧರಿಸಿ.", te: "బయట పనిని పరిమితం చేయండి; పని కొనసాగితే తగిన మాస్క్ ధరించండి.", zh: "限制户外工作；若必须继续，请戴合适口罩。", ru: "Ограничьте работу на улице; если она продолжается, наденьте подходящую маску.", ar: "قلّل العمل الخارجي؛ استخدم قناعًا مناسبًا إذا استمر العمل.", id: "Batasi kerja di luar; pakai masker yang sesuai jika kerja berlanjut.", pt: "Limite o trabalho fora; use máscara adequada se o trabalho continuar." },
  "Poor|everyone_else": { en: "Reduce outdoor activity; sensitive groups should stay indoors.", hi: "बाहरी गतिविधि कम करें; संवेदनशील लोग अंदर रहें।", mr: "बाह्य हालचाल कमी करा; संवेदनशील गटांनी आत राहावे.", bn: "বাইরের কাজ কমান; সংবেদনশীল গোষ্ঠী ঘরে থাকুক।", ta: "வெளிப்புற செயல்பாட்டை குறைக்கவும்; உணர்திறன் குழுக்கள் உள்ளே இருக்க வேண்டும்.", kn: "ಹೊರಗಿನ ಚಟುವಟಿಕೆ ಕಡಿಮೆ ಮಾಡಿ; ಸೂಕ್ಷ್ಮ ಗುಂಪು ಒಳಗೆ ಇರಲಿ.", te: "బయట కార్యకలాపం తగ్గించండి; సున్నితమైన వర్గాలు లోపల ఉండాలి.", zh: "减少户外活动；敏感人群应待在室内。", ru: "Сократите улицу; чувствительным группам лучше оставаться в помещении.", ar: "قلّل النشاط الخارجي؛ على الفئات الحساسة البقاء داخلًا.", id: "Kurangi aktivitas luar; kelompok sensitif sebaiknya di dalam.", pt: "Reduza a atividade fora; grupos sensíveis devem ficar em casa." },
  "Very Poor|children": { en: "Stay indoors. Avoid outdoor school sports.", hi: "अंदर रहें। स्कूल के बाहरी खेल से बचें।", mr: "आत रहा. शाळेतील बाह्य खेळ टाळा.", bn: "ঘরে থাকুন। স্কুলের বাইরের খেলা এড়ান।", ta: "உள்ளே இருங்கள். பள்ளி வெளிப்புற விளையாட்டை தவிர்க்கவும்.", kn: "ಒಳಗೆ ಇರಿ. ಶಾಲೆಯ ಹೊರಾಟ ತಪ್ಪಿಸಿ.", te: "లోపల ఉండండి. పాఠశాల బయట ఆటను నివారించండి.", zh: "待在室内。避免学校户外运动。", ru: "Оставайтесь в помещении. Не участвуйте в школьном спорте на улице.", ar: "ابقَ داخلًا. تجنّب رياضة المدرسة خارجًا.", id: "Tetap di dalam. Hindari olahraga sekolah di luar.", pt: "Fique em casa. Evite esportes escolares ao ar livre." },
  "Very Poor|elderly": { en: "Stay indoors. Avoid outdoor errands.", hi: "अंदर रहें। बाहरी कामों से बचें।", mr: "आत रहा. बाहेरची कामे टाळा.", bn: "ঘরে থাকুন। বাইরের কাজ এড়ান।", ta: "உள்ளே இருங்கள். வெளிப்புற வேலைகளை தவிர்க்கவும்.", kn: "ಒಳಗೆ ಇರಿ. ಹೊರಗಿನ ಕೆಲಸ ತಪ್ಪಿಸಿ.", te: "లోపల ఉండండి. బయట పనులు నివారించండి.", zh: "待在室内。避免外出办事。", ru: "Оставайтесь в помещении. Не выходите по делам.", ar: "ابقَ داخلًا. تجنّب المشاوير الخارجية.", id: "Tetap di dalam. Hindari urusan di luar.", pt: "Fique em casa. Evite tarefas fora." },
  "Very Poor|asthma_heart": { en: "Stay indoors. Seek care if breathing worsens.", hi: "अंदर रहें। सांस बिगड़े तो देखभाल लें।", mr: "आत रहा. श्वास बिघडल्यास काळजी घ्या.", bn: "ঘরে থাকুন। শ্বাস খারাপ হলে চিকিৎসা নিন।", ta: "உள்ளே இருங்கள். மூச்சு மோசமானால் சிகிச்சை பெறுங்கள்.", kn: "ಒಳಗೆ ಇರಿ. ಉಸಿರಾಟ ಕೆಟ್ಟರೆ ಚಿಕಿತ್ಸೆ ಪಡೆಯಿರಿ.", te: "లోపల ఉండండి. శ్వాస తీవ్రమైతే చికిత్స తీసుకోండి.", zh: "待在室内。呼吸变差请就医。", ru: "Оставайтесь в помещении. Обратитесь за помощью, если дыхание ухудшится.", ar: "ابقَ داخلًا. اطلب رعاية إذا ساء التنفس.", id: "Tetap di dalam. Cari perawatan jika napas memburuk.", pt: "Fique em casa. Procure cuidado se a respiração piorar." },
  "Very Poor|outdoor_workers": { en: "Postpone non-essential outdoor work; use protection if essential.", hi: "अनावश्यक बाहरी काम टालें; जरूरी हो तो सुरक्षा पहनें।", mr: "अनावश्यक बाह्य काम पुढे ढकला; आवश्यक असल्यास संरक्षण वापरा.", bn: "অপ্রয়োজনীয় বাইরের কাজ পিছিয়ে দিন; জরুরি হলে সুরক্ষা ব্যবহার করুন।", ta: "அவசியமில்லாத வெளிப்புற வேலையை ஒத்திவையுங்கள்; அவசியமானால் பாதுகாப்பு பயன்படுத்துங்கள்.", kn: "ಅನಗತ್ಯ ಹೊರಗಿನ ಕೆಲಸ ಮುಂದೂಡಿ; ಅಗತ್ಯವಿದ್ದರೆ ರಕ್ಷಣೆ ಬಳಸಿ.", te: "అనవసరమైన బయట పనిని వాయిదా వేయండి; అవసరమైతే రక్షణ వాడండి.", zh: "推迟非必要户外工作；必须做时请做好防护。", ru: "Отложите необязательную работу на улице; если она необходима, используйте защиту.", ar: "أجّل العمل الخارجي غير الضروري؛ استخدم حماية إذا كان ضروريًا.", id: "Tunda kerja luar yang tidak penting; gunakan pelindung jika penting.", pt: "Adie trabalho fora que não seja essencial; use proteção se for." },
  "Very Poor|everyone_else": { en: "Avoid outdoor activity. Keep windows closed when outdoor air is worse.", hi: "बाहरी गतिविधि से बचें। बाहर की हवा खराब हो तो खिड़कियाँ बंद रखें।", mr: "बाह्य हालचाल टाळा. बाहेरची हवा वाईट असल्यास खिडक्या बंद ठेवा.", bn: "বাইরের কাজ এড়ান। বাইরের বাতাস খারাপ হলে জানালা বন্ধ রাখুন।", ta: "வெளிப்புற செயல்பாட்டை தவிர்க்கவும். வெளிக்காற்று மோசமாக இருந்தால் ஜன்னல்களை மூடுங்கள்.", kn: "ಹೊರಗಿನ ಚಟುವಟಿಕೆ ತಪ್ಪಿಸಿ. ಹೊರಗಿನ ಗಾಳಿ ಕೆಟ್ಟಿದ್ದರೆ ಕಿಟಕಿ ಮುಚ್ಚಿ.", te: "బయట కార్యకలాపం నివారించండి. బయట గాలి చెడ్డగా ఉంటే కిటికీలు మూసి ఉంచండి.", zh: "避免户外活动。室外空气更差时关上窗。", ru: "Избегайте улицы. Закройте окна, если снаружи воздух хуже.", ar: "تجنّب النشاط الخارجي. أغلق النوافذ إذا كان الهواء الخارجي أسوأ.", id: "Hindari aktivitas luar. Tutup jendela jika udara luar lebih buruk.", pt: "Evite atividade fora. Feche as janelas se o ar externo estiver pior." },
  "Severe|children": { en: "Remain indoors. Emergency care if breathing is difficult.", hi: "अंदर रहें। सांस मुश्किल हो तो आपात देखभाल लें।", mr: "आत रहा. श्वास कठीण असल्यास आपत्कालीन काळजी घ्या.", bn: "ঘরে থাকুন। শ্বাস কষ্ট হলে জরুরি চিকিৎসা নিন।", ta: "உள்ளேயே இருங்கள். மூச்சு கஷ்டமானால் அவசர சிகிச்சை பெறுங்கள்.", kn: "ಒಳಗೇ ಇರಿ. ಉಸಿರಾಟ ಕಷ್ಟವಾದರೆ ತುರ್ತು ಚಿಕಿತ್ಸೆ ಪಡೆಯಿರಿ.", te: "లోపలే ఉండండి. శ్వాస కష్టమైతే అత్యవసర చికిత్స తీసుకోండి.", zh: "留在室内。呼吸困难请寻求急救。", ru: "Оставайтесь в помещении. При затруднённом дыхании нужна срочная помощь.", ar: "ابقَ داخلًا. اطلب رعاية طارئة إذا صعب التنفس.", id: "Tetap di dalam. Cari gawat darurat jika napas sulit.", pt: "Permaneça em casa. Procure emergência se a respiração dificultar." },
  "Severe|elderly": { en: "Remain indoors. Emergency care if breathing is difficult.", hi: "अंदर रहें। सांस मुश्किल हो तो आपात देखभाल लें।", mr: "आत रहा. श्वास कठीण असल्यास आपत्कालीन काळजी घ्या.", bn: "ঘরে থাকুন। শ্বাস কষ্ট হলে জরুরি চিকিৎসা নিন।", ta: "உள்ளேயே இருங்கள். மூச்சு கஷ்டமானால் அவசர சிகிச்சை பெறுங்கள்.", kn: "ಒಳಗೇ ಇರಿ. ಉಸಿರಾಟ ಕಷ್ಟವಾದರೆ ತುರ್ತು ಚಿಕಿತ್ಸೆ ಪಡೆಯಿರಿ.", te: "లోపలే ఉండండి. శ్వాస కష్టమైతే అత్యవసర చికిత్స తీసుకోండి.", zh: "留在室内。呼吸困难请寻求急救。", ru: "Оставайтесь в помещении. При затруднённом дыхании нужна срочная помощь.", ar: "ابقَ داخلًا. اطلب رعاية طارئة إذا صعب التنفس.", id: "Tetap di dalam. Cari gawat darurat jika napas sulit.", pt: "Permaneça em casa. Procure emergência se a respiração dificultar." },
  "Severe|asthma_heart": { en: "Remain indoors. Seek emergency care if symptoms worsen.", hi: "अंदर रहें। लक्षण बढ़ें तो आपात देखभाल लें।", mr: "आत रहा. लक्षण वाढल्यास आपत्कालीन काळजी घ्या.", bn: "ঘরে থাকুন। লক্ষণ বাড়লে জরুরি চিকিৎসা নিন।", ta: "உள்ளேயே இருங்கள். அறிகுறிகள் மோசமானால் அவசர சிகிச்சை பெறுங்கள்.", kn: "ಒಳಗೇ ಇರಿ. ಲಕ್ಷಣ ಹೆಚ್ಚಾದರೆ ತುರ್ತು ಚಿಕಿತ್ಸೆ ಪಡೆಯಿರಿ.", te: "లోపలే ఉండండి. లక్షణాలు పెరిగితే అత్యవసర చికిత్స తీసుకోండి.", zh: "留在室内。症状加重请寻求急救。", ru: "Оставайтесь в помещении. При усилении симптомов нужна срочная помощь.", ar: "ابقَ داخلًا. اطلب رعاية طارئة إذا ساءت الأعراض.", id: "Tetap di dalam. Cari gawat darurat jika gejala memburuk.", pt: "Permaneça em casa. Procure emergência se os sintomas piorarem." },
  "Severe|outdoor_workers": { en: "Stop outdoor work unless life-critical and protected.", hi: "जान के लिए जरूरी और सुरक्षित न हो तो बाहरी काम रोकें।", mr: "जीवनावश्यक आणि संरक्षित नसल्यास बाह्य काम थांबवा.", bn: "জীবনরক্ষাকারী ও সুরক্ষিত না হলে বাইরের কাজ বন্ধ করুন।", ta: "உயிருக்கு அவசியமும் பாதுகாப்பும் இல்லையென்றால் வெளிப்புற வேலையை நிறுத்துங்கள்.", kn: "ಜೀವರಕ್ಷಕ ಮತ್ತು ಸಂರಕ್ಷಿತವಲ್ಲದಿದ್ದರೆ ಹೊರಗಿನ ಕೆಲಸ ನಿಲ್ಲಿಸಿ.", te: "ప్రాణాంతకం కాకపోతే మరియు రక్షణ లేకపోతే బయట పని ఆపండి.", zh: "除非攸关生命且有防护，否则停止户外工作。", ru: "Прекратите работу на улице, если она не жизненно необходима и без защиты.", ar: "أوقف العمل الخارجي إلا إذا كان لإنقاذ الحياة ومع حماية.", id: "Hentikan kerja di luar kecuali menyelamatkan nyawa dan terlindungi.", pt: "Pare o trabalho fora, salvo se for vital e com proteção." },
  "Severe|everyone_else": { en: "Remain indoors. Avoid all outdoor exertion.", hi: "अंदर रहें। हर बाहरी मेहनत से बचें।", mr: "आत रहा. सर्व बाह्य श्रम टाळा.", bn: "ঘরে থাকুন। সব বাইরের পরিশ্রম এড়ান।", ta: "உள்ளேயே இருங்கள். எல்லா வெளிப்புற உழைப்பையும் தவிர்க்கவும்.", kn: "ಒಳಗೇ ಇರಿ. ಎಲ್ಲ ಹೊರಗಿನ ಶ್ರಮ ತಪ್ಪಿಸಿ.", te: "లోపలే ఉండండి. అన్ని బయట శ్రమలను నివారించండి.", zh: "留在室内。避免一切户外用力。", ru: "Оставайтесь в помещении. Избегайте любой нагрузки на улице.", ar: "ابقَ داخلًا. تجنّب كل جهد خارجي.", id: "Tetap di dalam. Hindari semua kerja berat di luar.", pt: "Permaneça em casa. Evite todo esforço ao ar livre." },
};

const ATTRIBUTION: Record<string, Line> = {
  "Paraphrase of CPCB National AQI health statements for each band.": {
    en: "Paraphrase of CPCB National AQI health statements for each band.",
    hi: "प्रत्येक बैंड के लिए CPCB राष्ट्रीय AQI स्वास्थ्य कथनों का सार।",
    mr: "प्रत्येक पट्ट्यासाठी CPCB राष्ट्रीय AQI आरोग्य विधानांचा सारांश.",
    bn: "প্রতিটি ব্যান্ডের জন্য CPCB জাতীয় AQI স্বাস্থ্য বিবৃতির সারাংশ।",
    ta: "ஒவ்வொரு பட்டைக்கும் CPCB தேசிய AQI சுகாதார கூற்றுகளின் சுருக்கம்.",
    kn: "ಪ್ರತಿ ವಲಯಕ್ಕೆ CPCB ರಾಷ್ಟ್ರೀಯ AQI ಆರೋಗ್ಯ ಹೇಳಿಕೆಗಳ ಸಾರಾಂಶ.",
    te: "ప్రతి బ్యాండ్‌కు CPCB జాతీయ AQI ఆరోగ్య ప్రకటనల సారాంశం.",
    zh: "各等级对 CPCB 国家 AQI 健康说明的转述。",
    ru: "Пересказ медицинских формулировок национального AQI CPCB для каждого уровня.",
    ar: "إعادة صياغة لبيانات صحة مؤشر AQI الوطني لـ CPCB لكل فئة.",
    id: "Parafrase pernyataan kesehatan AQI Nasional CPCB untuk tiap pita.",
    pt: "Paráfrase das orientações de saúde do AQI nacional do CPCB para cada faixa.",
  },
  "US EPA AQI bands mapped onto the same health actions.": {
    en: "US EPA AQI bands mapped onto the same health actions.",
    hi: "US EPA AQI बैंड को उन्हीं स्वास्थ्य कदमों पर जोड़ा गया है।",
    mr: "US EPA AQI पट्ट्या त्याच आरोग्य कृतींवर जोडल्या आहेत.",
    bn: "US EPA AQI ব্যান্ড একই স্বাস্থ্য পদক্ষেপে ম্যাপ করা।",
    ta: "US EPA AQI பட்டைகள் அதே சுகாதார நடவடிக்கைகளுடன் இணைக்கப்பட்டுள்ளன.",
    kn: "US EPA AQI ವಲಯಗಳನ್ನು ಅದೇ ಆರೋಗ್ಯ ಕ್ರಮಗಳಿಗೆ ಜೋಡಿಸಲಾಗಿದೆ.",
    te: "US EPA AQI బ్యాండ్‌లు అదే ఆరోగ్య చర్యలకు కలపబడ్డాయి.",
    zh: "美国 EPA AQI 等级对应同一套健康建议。",
    ru: "Диапазоны AQI EPA США сопоставлены с теми же мерами.",
    ar: "فئات AQI لوكالة EPA الأمريكية مربوطة بنفس الإجراءات الصحية.",
    id: "Pita AQI EPA AS dipetakan ke tindakan kesehatan yang sama.",
    pt: "Faixas de AQI da EPA dos EUA ligadas às mesmas ações de saúde.",
  },
};

const ADVICE_MISSING: Record<string, string> = {
  en: "No translated advice for this group.",
  hi: "इस समूह के लिए अनुवादित सलाह नहीं है।",
  mr: "या गटासाठी भाषांतरित सल्ला नाही.",
  bn: "এই দলের জন্য অনুবাদিত পরামর্শ নেই।",
  ta: "இந்தக் குழுவுக்கு மொழிபெயர்ப்பு அறிவுரை இல்லை.",
  kn: "ಈ ಗುಂಪಿಗೆ ಅನುವಾದಿತ ಸಲಹೆ ಇಲ್ಲ.",
  te: "ఈ సమూహానికి అనువాద సలహా లేదు.",
  zh: "这个群体没有译文建议。",
  ru: "Нет перевода совета для этой группы.",
  ar: "لا توجد نصيحة مترجمة لهذه الفئة.",
  id: "Tidak ada saran terjemahan untuk kelompok ini.",
  pt: "Não há conselho traduzido para este grupo.",
};

export function groupAdvice(lang: string, band: string, group: string, english: string): string {
  const row = ADVICE[`${band}|${group}`];
  if (lang === "en") return row?.en ?? english;
  return row?.[lang] ?? ADVICE_MISSING[lang] ?? ADVICE_MISSING.en;
}

const BRIEF_FALLBACK: Record<string, string> = {
  en: "A written air-quality note is unavailable. Use the station reading and open incidents on this page.",
  hi: "लिखित वायु-गुणवत्ता नोट उपलब्ध नहीं है। इस पृष्ठ पर स्टेशन रीडिंग और खुली घटनाएँ देखें।",
  mr: "लिखित हवेचा नोट उपलब्ध नाही. या पानावरील स्टेशन रीडिंग आणि खुले घटना पहा.",
  bn: "লিখিত বায়ুমান নোট নেই। এই পাতায় স্টেশন রিডিং ও খোলা ঘটনা দেখুন।",
  ta: "எழுத்து காற்று குறிப்பு இல்லை. இந்தப் பக்கத்தில் நிலைய அளவையும் திறந்த சம்பவங்களையும் பாருங்கள்.",
  kn: "ಲಿಖಿತ ಗಾಳಿ ಟಿಪ್ಪಣಿ ಇಲ್ಲ. ಈ ಪುಟದ ಕೇಂದ್ರ ಓದು ಮತ್ತು ತೆರೆದ ಘಟನೆಗಳನ್ನು ನೋಡಿ.",
  te: "వ్రాతపూర్వక గాలి నోట్ లేదు. ఈ పేజీలో స్టేషన్ రీడింగ్ మరియు తెరిచిన ఘటనలు చూడండి.",
  zh: "没有书面空气质量说明。请查看本页的站点读数和未关闭事件。",
  ru: "Текстовой справки о воздухе нет. Смотрите показание станции и открытые инциденты на этой странице.",
  ar: "لا توجد ملاحظة مكتوبة عن الهواء. انظر قراءة المحطة والحوادث المفتوحة في هذه الصفحة.",
  id: "Catatan udara tertulis tidak tersedia. Lihat pembacaan stasiun dan insiden terbuka di halaman ini.",
  pt: "Não há uma nota escrita sobre o ar. Veja a leitura da estação e os incidentes abertos nesta página.",
};

export function briefFallback(lang: string): string {
  return BRIEF_FALLBACK[lang] ?? BRIEF_FALLBACK.en;
}

const BRIEF_SCRIPT: Record<string, RegExp> = {
  hi: /\p{Script=Devanagari}/u,
  mr: /\p{Script=Devanagari}/u,
  bn: /\p{Script=Bengali}/u,
  ta: /\p{Script=Tamil}/u,
  kn: /\p{Script=Kannada}/u,
  te: /\p{Script=Telugu}/u,
  zh: /\p{Script=Han}/u,
  ru: /\p{Script=Cyrillic}/u,
  ar: /\p{Script=Arabic}/u,
};

const ENGLISH_WORDS = /\b(the|and|of|is|to|for|with|this|that|from|are|was)\b/gi;
const ID_MARK = /\b(yang|dan|untuk|dengan|tidak|udara|kualitas|ini|dari|atau)\b/i;
const PT_MARK = /[ãõçáéíóúâêô]/i;
const PT_WORDS = /\b(não|para|qualidade|está|dos|das|uma|com)\b/i;

function looksEnglish(value: string): boolean {
  return (value.match(ENGLISH_WORDS)?.length ?? 0) >= 3;
}

export function briefForLang(lang: string, text: string): string {
  const value = text.trim();
  if (!value) return briefFallback(lang);
  const script = BRIEF_SCRIPT[lang];
  if (script && !script.test(value)) return briefFallback(lang);
  if (lang === "id" && looksEnglish(value) && !ID_MARK.test(value)) return briefFallback(lang);
  if (lang === "pt" && looksEnglish(value) && !PT_MARK.test(value) && !PT_WORDS.test(value)) return briefFallback(lang);
  return value;
}

const TRACK_HEAD: Record<string, string> = {
  en: "Report status",
  hi: "रिपोर्ट की स्थिति",
  mr: "अहवालाची स्थिती",
  bn: "রিপোর্টের অবস্থা",
  ta: "அறிக்கை நிலை",
  kn: "ವರದಿ ಸ್ಥಿತಿ",
  te: "నివేదిక స్థితి",
  zh: "报告状态",
  ru: "Статус сообщения",
  ar: "حالة البلاغ",
  id: "Status laporan",
  pt: "Estado do relato",
};

export function trackHeading(lang: string, which?: number): string {
  const label = TRACK_HEAD[lang] ?? TRACK_HEAD.en;
  return which && which > 0 ? `${label} ${which}` : label;
}

export type SavedTrack = { id: string; hazard?: string; city?: string; at?: string };

export function savedTracks(): SavedTrack[] {
  const raw = localStorage.getItem("zephyr.tracks") ?? "";
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as SavedTrack[];
      return Array.isArray(parsed) ? parsed.filter((item) => item?.id).slice(0, 5) : [];
    } catch {
      return [];
    }
  }
  return raw.split(",").filter(Boolean).map((id) => ({ id }));
}

export function rememberTrack(id: string, extra?: { hazard?: string; city?: string }) {
  const prev = savedTracks();
  const old = prev.find((item) => item.id === id);
  const next = [{ id, hazard: extra?.hazard ?? old?.hazard, city: extra?.city ?? old?.city, at: old?.at ?? new Date().toISOString() }, ...prev.filter((item) => item.id !== id)].slice(0, 5);
  localStorage.setItem("zephyr.tracks", JSON.stringify(next));
  window.dispatchEvent(new Event("zephyr-tracks"));
}

export function advisoryNote(lang: string, english: string): string {
  const row = ATTRIBUTION[english];
  if (lang === "en") return row?.en ?? english;
  return row?.[lang] ?? (ADVICE_MISSING[lang] ?? ADVICE_MISSING.en);
}
