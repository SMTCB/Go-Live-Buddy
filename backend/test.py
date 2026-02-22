import traceback
try:
    import database
except Exception as e:
    with open('err.txt', 'w') as f:
        traceback.print_exc(file=f)
