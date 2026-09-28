# datasources

Put raw dumps here. This folder is gitignored except this file.

Expected layout:

```text
datasources/
  usda-fdc/
    foundation-2026-04-30/
      FoodData_Central_foundation_food_csv_2026-04-30/
        food.csv
        food_nutrient.csv
        nutrient.csv
        foundation_food.csv
        food_category.csv
        food_portion.csv
    sr-legacy-2018-04/
      FoodData_Central_sr_legacy_food_csv_2018-04/
        food.csv
        ...
  openfoodfacts/
    csv-en/
      en.openfoodfacts.org.products.csv.gz
  fao-infoods/
    wafct-2019/
      WAFCT_2019.xlsx
  frida/
    5.5/
      Frida_5.5_Dataset.xlsx
  foodb/
    2020-04-07/
      ...json / ndjson...
```

If this repo sits next to the Grok project folder, you can symlink:

```bash
# from food-sources-viewer/
ln -s ../data/raw/usda-fdc datasources/usda-fdc
ln -s ../data/raw/openfoodfacts datasources/openfoodfacts
ln -s ../data/raw/fao-infoods datasources/fao-infoods
ln -s ../data/raw/frida datasources/frida
ln -s ../data/raw/foodb datasources/foodb
```
